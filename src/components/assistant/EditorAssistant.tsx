import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Content, GenerativeModel } from '@google/generative-ai';
import { Loader2, ExternalLink, Sparkles } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

const MODEL_NAME = 'gemini-2.0-flash-001';
const STYLUS_DOC_URL = 'https://docs.arbitrum.io/stylus';
const LLM_GUIDE_PATH = '/llm.tx';

const STYLUS_KEYWORDS = [
  'stylus',
  'smart contract',
  'contract',
  'wasm',
  'abi',
  'deploy',
  'compile',
  'bytecode',
  'solidity',
  'rust',
];

type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  docsLink?: string;
};

interface EditorAssistantProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string;
}

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const containsStylusKeyword = (text: string) =>
  STYLUS_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(text));

export function EditorAssistant({ open, onOpenChange, projectName }: EditorAssistantProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [guide, setGuide] = useState<string>('');
  const [guideError, setGuideError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<GenerativeModel | null>(null);

  const apiKey = useMemo(() => import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY ?? '', []);
  const systemPrompt = useMemo(() => {
    if (!guide) return '';
    return `${guide}\n\nConstraints:\n- Only answer IDE navigation and tooling questions.\n- Never claim to modify or execute code.\n- Stylus language or smart contract questions must link to ${STYLUS_DOC_URL}.`;
  }, [guide]);

  useEffect(() => {
    let isMounted = true;

    const loadGuide = async () => {
      try {
        const response = await fetch(LLM_GUIDE_PATH);
        if (!response.ok) {
          throw new Error(`Failed to load llm guidance (${response.status})`);
        }
        const text = await response.text();
        if (isMounted) {
          setGuide(text);
          setGuideError(null);
        }
      } catch (error) {
        if (isMounted) {
          console.error('[EditorAssistant] Failed to load llm.tx:', error);
          setGuideError('Unable to load IDE guidance (llm.tx). Ensure the file exists in /public.');
        }
      }
    };

    loadGuide();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!systemPrompt) return;

    if (!apiKey) {
      setModelError('Missing VITE_GOOGLE_GENERATIVE_AI_API_KEY. Add it to your .env.local file to enable Gemini.');
      return;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
      });
      modelRef.current = model;
      setModelError(null);
    } catch (error) {
      console.error('[EditorAssistant] Failed to initialize Gemini model:', error);
      setModelError('Failed to initialize Gemini. Check the API key and try again.');
    }
  }, [systemPrompt, apiKey]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    if (!guide) return;
    setMessages([
      {
        id: createId(),
        role: 'assistant',
        content:
          `Hi${projectName ? `! You're working on ${projectName}.` : ''} Ask me about navigating the Wizard IDE ` +
          `— templates, compilation, filesystem, terminals, or troubleshooting. Stylus language help will go to the official docs.`,
      },
    ]);
  }, [guide, projectName]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || guideError || modelError) return;

    const userMessage: AssistantMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    if (containsStylusKeyword(trimmed)) {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          content: 'For Stylus language, contract patterns, or deployment specifics, consult the official documentation below.',
          docsLink: STYLUS_DOC_URL,
        },
      ]);
      return;
    }

    const model = modelRef.current;
    if (!model) {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          content: 'Gemini is not configured yet. Verify the API key and reload the page.',
        },
      ]);
      return;
    }

    setIsSending(true);
    try {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: systemPrompt }],
        },
        ...[...messages, userMessage]
          .filter((message) => message.role !== 'assistant' || message.docsLink === undefined)
          .map((message): Content => (
            message.role === 'assistant'
              ? {
                  role: 'model',
                  parts: [{ text: message.content }],
                }
              : {
                  role: 'user',
                  parts: [{ text: message.content }],
                }
          )),
      ];

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(trimmed);
      const responseText = result.response.text().trim();

      if (responseText) {
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            content: responseText,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            content: 'I could not generate a response. Try rephrasing your question.',
          },
        ]);
      }
    } catch (error) {
      console.error('[EditorAssistant] Gemini response error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          content: 'Gemini request failed. Check your network connection and API key configuration.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full flex-col gap-4 sm:max-w-xl">
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Assistant
          </SheetTitle>
          <SheetDescription>
            Answers Wizard IDE navigation, troubleshooting and stylus contract questions.
          </SheetDescription>
        </SheetHeader>

        {guideError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {guideError}
          </div>
        )}

        {modelError && (
          <div className="rounded-md border border-muted bg-muted/50 p-3 text-sm text-muted-foreground">
            {modelError}
          </div>
        )}

        <ScrollArea className="flex-1 rounded-md border bg-muted/30 p-4">
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm'
                    : 'mr-auto max-w-[85%] rounded-lg bg-background px-3 py-2 text-sm shadow-sm'
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                {message.docsLink && (
                  <a
                    href={message.docsLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2"
                  >
                    Visit Stylus documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
            {isSending && (
              <div className="mr-auto flex max-w-[85%] items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm shadow-sm">
                <span className="text-muted-foreground">Thinking</span>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <form className="space-y-3" onSubmit={handleSend}>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              guideError
                ? 'Assistant unavailable until llm.tx loads.'
                : modelError
                ? 'Provide a Gemini API key to enable responses.'
                : 'Ask about files, compilation, templates, or troubleshooting in Wizard.'
            }
            className="min-h-[96px] resize-none"
            disabled={isSending || !!guideError}
          />
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-muted-foreground">
              Responses stay local. No chat history is stored.
            </span>
            <Button type="submit" disabled={isSending || !input.trim() || !!guideError || !!modelError}>
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Thinking
                </>
              ) : (
                'Send'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
