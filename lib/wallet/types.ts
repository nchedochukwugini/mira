export type SolanaPublicKey = { toBase58(): string; toString(): string };

export type SolanaWallet = {
  isPhantom?: boolean;
  publicKey: SolanaPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: SolanaPublicKey }>;
  disconnect(): Promise<void>;
  signTransaction<T>(transaction: T): Promise<T>;
};

declare global {
  interface Window { solana?: SolanaWallet }
}
