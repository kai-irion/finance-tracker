"use client";

import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  isFirst: boolean;
  isLast: boolean;
  isDropTarget: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTop: () => void;
  onHide: () => void;
  hideLabel?: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  children: ReactNode;
};

/**
 * Uniform card wrapper for every chart on dashboard/analysis — standard or AI.
 * Drag originates ONLY from the grip handle (reliable HTML5 DnD); the card body
 * stays fully interactive (charts, buttons, text selection). Arrow buttons +
 * "move to top" are the touch-device / keyboard fallback and always work.
 */
export function SortableSection({
  title,
  isFirst,
  isLast,
  isDropTarget,
  onMoveUp,
  onMoveDown,
  onMoveTop,
  onHide,
  hideLabel = "Hide",
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  children,
}: Props) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={`card p-4 transition-colors ${isDropTarget ? "border-accent border-dashed" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", title);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            className="shrink-0 cursor-grab active:cursor-grabbing text-muted select-none touch-none px-1 text-base leading-none"
            title="Drag to reorder"
            aria-label={`Drag ${title} to reorder`}
          >
            ⠿
          </span>
          <h2 className="text-sm font-medium text-neutral-700 truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMoveTop}
            disabled={isFirst}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
            aria-label={`Move ${title} to top`}
            title="Move to top"
          >
            ⤒
          </button>
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
            aria-label={`Move ${title} up`}
            title="Move up"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
            aria-label={`Move ${title} down`}
            title="Move down"
          >
            ↓
          </button>
          <button
            onClick={onHide}
            className="shrink-0 text-xs text-muted hover:text-danger ml-1"
            aria-label={`${hideLabel} ${title}`}
          >
            {hideLabel}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
