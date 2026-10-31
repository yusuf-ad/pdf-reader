import SplitView from "@/components/split-view";
import StorageGate from "@/components/storage-gate";

export default function Home() {
  return (
    <StorageGate>
      <SplitView />
    </StorageGate>
  );
}
