#!/usr/bin/env python3
"""Train a small MIRA intent classifier from random initialization using NumPy only."""

from __future__ import annotations

import json
import argparse
import re
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
TRAIN_PATH = ROOT / "data" / "intents_train.jsonl"
EVAL_PATH = ROOT / "data" / "intents_eval.jsonl"
OUTPUT_PATH = ROOT / "artifacts" / "mira_intent_v0.json"
FEATURES = 2048
SEED = 41
LEARNING_RATE = 0.5
EPOCHS = 2000
PATIENCE = 100


def read_examples(path: Path) -> list[dict[str, str]]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise ValueError(f"No examples found in {path}")
    for row in rows:
        if not isinstance(row.get("text"), str) or not row["text"].strip() or not isinstance(row.get("intent"), str):
            raise ValueError(f"Invalid training example in {path}: {row!r}")
    return rows


def fnv1a(value: str) -> int:
    result = 2166136261
    for byte in value.encode("utf-8"):
        result ^= byte
        result = (result * 16777619) & 0xFFFFFFFF
    return result


def feature_items(text: str) -> list[tuple[str, float]]:
    normalized = " " + " ".join(re.findall(r"[a-z0-9]+", text.lower())) + " "
    tokens = normalized.strip().split()
    items: list[tuple[str, float]] = []
    items.extend((f"w:{token}", 1.0) for token in tokens)
    items.extend((f"b:{left}_{right}", 1.0) for left, right in zip(tokens, tokens[1:]))
    compact = f"^{normalized.strip()}$"
    items.extend((f"c:{compact[index:index + width]}", 0.4) for width in (3, 4, 5) for index in range(max(0, len(compact) - width + 1)))
    return items


def encode(text: str) -> np.ndarray:
    vector = np.zeros(FEATURES, dtype=np.float32)
    for feature, value in feature_items(text):
        hashed = fnv1a(feature)
        index = hashed % FEATURES
        vector[index] += value if hashed & 0x80000000 == 0 else -value
    norm = np.linalg.norm(vector)
    if norm:
        vector /= norm
    return vector


def load_matrix(rows: list[dict[str, str]], labels: dict[str, int]) -> tuple[np.ndarray, np.ndarray]:
    x = np.stack([encode(row["text"]) for row in rows])
    y = np.asarray([labels[row["intent"]] for row in rows], dtype=np.int64)
    return x, y


def probabilities(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def cross_entropy(logits: np.ndarray, targets: np.ndarray) -> float:
    probs = probabilities(logits)
    return float(-np.log(np.maximum(probs[np.arange(len(targets)), targets], 1e-12)).mean())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="continue from the existing artifact instead of random initialization",
    )
    args = parser.parse_args()

    train = read_examples(TRAIN_PATH)
    evaluation = read_examples(EVAL_PATH)
    labels_order = sorted({row["intent"] for row in train})
    labels = {label: index for index, label in enumerate(labels_order)}
    unknown = sorted({row["intent"] for row in evaluation} - labels.keys())
    if unknown:
        raise ValueError(f"Evaluation contains labels not in training data: {unknown}")

    x_train, y_train = load_matrix(train, labels)
    x_eval, y_eval = load_matrix(evaluation, labels)
    previous_artifact = None
    if args.resume:
        if not OUTPUT_PATH.exists():
            raise FileNotFoundError(f"Cannot resume: model artifact does not exist at {OUTPUT_PATH}")
        previous_artifact = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        if previous_artifact.get("labels") != labels_order or previous_artifact.get("feature_count") != FEATURES:
            raise ValueError("Cannot resume: artifact labels or feature count do not match this training run")
        weights = np.asarray(previous_artifact["weights"], dtype=np.float32)
        bias = np.asarray(previous_artifact["bias"], dtype=np.float32)
        if weights.shape != (FEATURES, len(labels)) or bias.shape != (len(labels),):
            raise ValueError("Cannot resume: artifact parameter shapes are invalid")
    else:
        rng = np.random.default_rng(SEED)
        weights = rng.normal(0, 0.01, size=(FEATURES, len(labels))).astype(np.float32)
        bias = np.zeros(len(labels), dtype=np.float32)

    best_loss = cross_entropy(x_eval @ weights + bias, y_eval)
    best_weights = weights.copy()
    best_bias = bias.copy()
    stale_epochs = 0

    for epoch in range(1, EPOCHS + 1):
        train_probs = probabilities(x_train @ weights + bias)
        train_probs[np.arange(len(y_train)), y_train] -= 1
        grad_weights = (x_train.T @ train_probs) / len(y_train) + 0.0001 * weights
        grad_bias = train_probs.mean(axis=0)
        weights -= LEARNING_RATE * grad_weights
        bias -= LEARNING_RATE * grad_bias

        eval_logits = x_eval @ weights + bias
        eval_loss = cross_entropy(eval_logits, y_eval)
        if eval_loss < best_loss - 1e-5:
            best_loss = eval_loss
            best_weights = weights.copy()
            best_bias = bias.copy()
            stale_epochs = 0
        else:
            stale_epochs += 1
        if stale_epochs >= PATIENCE:
            break

    eval_probs = probabilities(x_eval @ best_weights + best_bias)
    predicted = eval_probs.argmax(axis=1)
    accuracy = float((predicted == y_eval).mean())
    train_accuracy = float(((x_train @ best_weights + best_bias).argmax(axis=1) == y_train).mean())
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "name": "MIRA small intent model",
        "version": "0.1.0",
        "trained_from_random_initialization": True if previous_artifact is None else previous_artifact.get("trained_from_random_initialization", False),
        "base_model": None,
        "architecture": "hashed word/character n-gram softmax classifier",
        "feature_count": FEATURES,
        "labels": labels_order,
        "weights": best_weights.tolist(),
        "bias": best_bias.tolist(),
        "training_examples": len(train),
        "evaluation_examples": len(evaluation),
        "evaluation_accuracy": accuracy,
        "seed": SEED,
        "epochs_this_run": epoch,
        "total_training_epochs": (previous_artifact.get("total_training_epochs", EPOCHS) if previous_artifact else 0) + epoch,
        "resumed_from_previous_artifact": previous_artifact is not None,
    }
    OUTPUT_PATH.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    print(f"trained_from_random_initialization={str(artifact['trained_from_random_initialization']).lower()} base_model=none resumed={str(args.resume).lower()}")
    print(f"examples train={len(train)} eval={len(evaluation)} classes={len(labels)}")
    print(f"epochs_this_run={epoch} total_training_epochs={artifact['total_training_epochs']} train_accuracy={train_accuracy:.3f} eval_accuracy={accuracy:.3f} eval_loss={best_loss:.3f}")
    print(f"artifact={OUTPUT_PATH} size_mb={OUTPUT_PATH.stat().st_size / (1024 * 1024):.2f}")
    for row, target, prediction, confidence in zip(evaluation, y_eval, predicted, eval_probs.max(axis=1)):
        status = "OK" if target == prediction else "MISS"
        print(f"{status:4} expected={labels_order[target]:18} predicted={labels_order[prediction]:18} confidence={confidence:.2f} text={row['text']}")


if __name__ == "__main__":
    main()
