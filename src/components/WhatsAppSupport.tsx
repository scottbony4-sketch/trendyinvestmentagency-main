import { MessageCircle } from "lucide-react";

const NUMBER = "447308516057";
const DISPLAY = "+447308516057";
const MSG = "Hello TRENDY INVESTMENT AGENCY, I need help with my account.";

export function whatsappLink(customMsg?: string) {
  return `https://wa.me/${NUMBER}?text=${encodeURIComponent(customMsg ?? MSG)}`;
}

export function WhatsAppFab() {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noreferrer"
      aria-label="WhatsApp support"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[oklch(0.7_0.18_150)] text-white shadow-[var(--shadow-gold)] transition-transform hover:scale-110"
    >
      <MessageCircle className="h-6 w-6" />
    </a>
  );
}

export function WhatsAppInline({ label = "Chat on WhatsApp" }: { label?: string }) {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20"
    >
      <MessageCircle className="h-3.5 w-3.5" /> {label} · {DISPLAY}
    </a>
  );
}

export { NUMBER as WHATSAPP_NUMBER, DISPLAY as WHATSAPP_DISPLAY };