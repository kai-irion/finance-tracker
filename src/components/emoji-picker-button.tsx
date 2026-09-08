"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";

// Icon-swatch trigger + full emoji keyboard (search included, via emoji-picker-react) in a
// popover — used anywhere a category icon is picked, instead of typing/pasting a raw emoji
// into a text input. `emojiStyle="native"` renders the browser's own emoji glyphs (matches
// how icons render everywhere else in the app) instead of fetching image sprites from a CDN.
export function EmojiPickerButton({
  value,
  onChange,
  placeholder = "＋",
  size = "md",
  align = "left",
}: {
  value: string | null;
  onChange: (emoji: string) => void;
  placeholder?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Choose an emoji"
        className={
          size === "sm"
            ? "flex items-center justify-center w-6 h-6 rounded hover:bg-neutral-100 text-base"
            : "flex items-center justify-center w-9 h-9 rounded-md border border-divider text-lg hover:bg-neutral-100"
        }
      >
        {value || <span className="text-neutral-400 text-sm">{placeholder}</span>}
      </button>
      {open && (
        <div className={`absolute z-30 top-full mt-1 ${align === "right" ? "right-0" : "left-0"}`}>
          <EmojiPicker
            onEmojiClick={(data: EmojiClickData) => {
              onChange(data.emoji);
              setOpen(false);
            }}
            emojiStyle={EmojiStyle.NATIVE}
            theme={Theme.LIGHT}
            autoFocusSearch
            width={320}
            height={400}
          />
        </div>
      )}
    </div>
  );
}
