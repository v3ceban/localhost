import { LlmChatProvider } from "@/hooks/use-llm-chat";
import { ChatMessages } from "@/components/chat/messages";
import { ChatComposer } from "@/components/chat/composer";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { q } = await searchParams;
  const query = Array.isArray(q) ? q[0] : q;

  return (
    <LlmChatProvider>
      <main className="mx-auto grid h-dvh w-full max-w-3xl grid-rows-[1fr_auto] gap-2 p-4">
        <ChatMessages />
        <ChatComposer query={query} />
      </main>
    </LlmChatProvider>
  );
}
