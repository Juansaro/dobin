import { useEffect } from "react";
import { AppShell } from "@/app/AppShell";
import { useAppStore } from "@/store/useAppStore";

export default function App() {
  const bootstrap = useAppStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return <AppShell />;
}
