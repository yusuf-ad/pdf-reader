import Reader from "@/components/reader";
import StorageGate from "@/components/storage-gate";

export default function Home() {
  return (
    <StorageGate>
      <Reader />
    </StorageGate>
  );
}
