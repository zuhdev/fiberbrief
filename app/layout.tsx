import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FiberBrief — Pay to unlock research on CKB',
  description: 'A pay-to-unlock research brief demo on CKB Testnet. The Fiber payment preimage is the AES key that opens the report.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
