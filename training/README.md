# MIRA training experiment 0.1

This first experiment trains a small intent classifier from random initialization. It uses no pretrained weights, API model, or external service. It is deliberately limited to deciding whether a message is a greeting, help request, market discovery, market analysis, market detail question, clarification, or general question.

The model does not write answers, calculate market data, browse the web, or replace Panta. MIRA's existing deterministic conversation rules and market intelligence remain authoritative while this experiment is evaluated.

## Run

The training script needs Python 3 and NumPy:

```sh
python3 -m pip install numpy
python3 training/train_intent.py
```

It writes `training/artifacts/mira_intent_v0.json`, reports held-out evaluation accuracy and each example's result, and records that the model was initialized from random weights. The training and evaluation JSONL files are intentionally separate. Do not add private conversations without removing personal, wallet, and account details and obtaining the user's permission to use them.

To continue training from the saved weights, run:

```sh
python3 training/train_intent.py --resume
```

Resume checks that the saved label list and feature count match the current training setup. It keeps the best checkpoint by held-out loss, including the starting checkpoint, and records the number of additional and total training epochs in the artifact. Keep the evaluation examples out of the training data.

## Limits

This is a routing experiment, not a general language model. Its small hand-written dataset is suitable for checking the training code and label design; it is not enough to claim reliable natural-language understanding. Before allowing model predictions to trigger Panta searches, expand and review the dataset, improve held-out evaluation, compare against MIRA's deterministic classifier, and keep market-tool calls behind explicit intent checks.
