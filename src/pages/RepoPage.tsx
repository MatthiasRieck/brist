import { useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { useHeader } from "@/contexts/HeaderContext";

export function RepoPage() {
  const { path } = useSearch({ from: "/repo" });
  const { setHeaderContent } = useHeader();
  const repoName = path.split("/").pop() ?? path;

  useEffect(() => {
    setHeaderContent(repoName);
    return () => setHeaderContent(null);
  }, [repoName, setHeaderContent]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">{repoName}</h1>
    </div>
  );
}
