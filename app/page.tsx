import { WorkspaceApp } from "@/components/workspace/WorkspaceApp";
import { getProviderEnvironment, getProviderMode } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export default function Page() {
  return <WorkspaceApp providerMode={getProviderMode()} providerEnvironment={getProviderEnvironment()} />;
}
