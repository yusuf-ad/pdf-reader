import SplitView from "@/components/split-view";
import StorageGate from "@/components/storage-gate";
import Onboarding from "@/components/onboarding";

export default function Home() {
  return (
    <StorageGate>
      <SplitView />
      <Onboarding />
    </StorageGate>
  );
}
