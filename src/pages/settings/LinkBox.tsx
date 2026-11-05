import { useState } from "react";
import { Icon } from "../../components/icons";
import { Button, buttonClass, inputClass } from "../../components/ui";

/**
 * A link or temporary password to pass on yourself: shown in full, with Copy and a WhatsApp share. `what` names it in
 * the sentence above ("invitation link", "password reset link", "temporary password").
 */
export function LinkBox({ value, what, person, message }: { value: string; what: string; person: string; message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure origin): the text is selected for a manual copy instead.
      document.getElementById("link-box-value")?.focus();
    }
  };
  return (
    <div className="space-y-2">
      <p>
        Send this {what} to <strong className="font-semibold">{person}</strong>:
      </p>
      <div className="flex gap-2">
        <input
          id="link-box-value"
          readOnly
          value={value}
          aria-label={what}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} min-w-0 flex-1 font-mono text-meta`}
        />
        <Button variant="secondary" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <a
        className={buttonClass("ghost", "sm", "-ml-2.5")}
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="external" />
        Send on WhatsApp
      </a>
    </div>
  );
}
