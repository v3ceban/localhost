"use client";

import { Streamdown, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";

export function Response({ className, ...props }: StreamdownProps) {
  return (
    <Streamdown
      className={cn("typeset typeset-chat", className)}
      controls={{ table: false, code: false, mermaid: false }}
      lineNumbers={false}
      {...props}
    />
  );
}
