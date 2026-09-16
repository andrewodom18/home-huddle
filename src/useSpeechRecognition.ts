import { useEffect, useRef, useState } from "react";

type SpeechRecognitionState = {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
};

export function useSpeechRecognition(
  onTranscript: (transcript: string) => void,
): SpeechRecognitionState {
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptCallbackRef = useRef(onTranscript);

  useEffect(() => {
    transcriptCallbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    if (!supported) return;
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) transcriptCallbackRef.current(transcript);
    };
    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was not granted. You can keep typing."
          : "Voice input stopped. You can keep typing.",
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [supported]);

  return {
    supported,
    listening,
    error,
    start() {
      if (!recognitionRef.current || listening) return;
      setError(null);
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch {
        setError("Voice input is already active. You can keep typing.");
      }
    },
    stop() {
      recognitionRef.current?.stop();
      setListening(false);
    },
  };
}
