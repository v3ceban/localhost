import * as React from "react";
import { ModelDownloadDialogTrigger } from "@/components/model-download/dialog";

export default function Page({}: PageProps<"/">) {
  return (
    <main className="flex min-h-dvh min-w-dvw items-center justify-center">
      <ModelDownloadDialogTrigger />
    </main>
  );
}
