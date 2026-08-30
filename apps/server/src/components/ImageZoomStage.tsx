import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@pinar/ui";
import RotateCcwIcon from "~icons/lucide/rotate-ccw";
import ZoomInIcon from "~icons/lucide/zoom-in";
import ZoomOutIcon from "~icons/lucide/zoom-out";
import { useServerI18n } from "@/lib/i18n";

const MAX_SCALE = 8;
const MIN_SCALE = 0.5;
const ZOOM_FACTOR = 1.25;

interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

const INITIAL_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function useImageZoom(resetKey: string) {
  const [dragging, setDragging] = useState(false);
  const [transform, setTransform] = useState<ImageTransform>(INITIAL_TRANSFORM);
  const dragOrigin = useRef({ clientX: 0, clientY: 0, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTransform(INITIAL_TRANSFORM);
  }, [resetKey]);

  function resetZoom() {
    setTransform(INITIAL_TRANSFORM);
  }

  function zoomBy(factor: number, clientX?: number, clientY?: number) {
    const stage = stageRef.current;
    setTransform((current) => {
      const nextScale = clampScale(current.scale * factor);
      if (nextScale === current.scale || !stage) return current;
      const bounds = stage.getBoundingClientRect();
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const anchorX = clientX === undefined ? centerX : clientX - bounds.left;
      const anchorY = clientY === undefined ? centerY : clientY - bounds.top;
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: anchorX - centerX - ratio * (anchorX - centerX - current.x),
        y: anchorY - centerY - ratio * (anchorY - centerY - current.y),
      };
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragOrigin.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: transform.x,
      y: transform.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setTransform((current) => ({
      ...current,
      x: dragOrigin.current.x + event.clientX - dragOrigin.current.clientX,
      y: dragOrigin.current.y + event.clientY - dragOrigin.current.clientY,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return {
    dragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    resetZoom,
    stageRef,
    transform,
    zoomBy,
    zoomPercentage: Math.round(transform.scale * 100),
  };
}

export function ImageZoomControls({
  scale,
  onReset,
  onZoomBy,
}: {
  scale: number;
  onReset: () => void;
  onZoomBy: (factor: number) => void;
}) {
  const { t } = useServerI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm">
      <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
        {Math.round(scale * 100)}%
      </span>
      <Button
        aria-label={t("zoom.out")}
        disabled={scale <= MIN_SCALE}
        size="icon-sm"
        title={t("zoom.out")}
        variant="ghost"
        onClick={() => onZoomBy(1 / ZOOM_FACTOR)}
      >
        <ZoomOutIcon />
      </Button>
      <Button
        aria-label={t("zoom.in")}
        disabled={scale >= MAX_SCALE}
        size="icon-sm"
        title={t("zoom.in")}
        variant="ghost"
        onClick={() => onZoomBy(ZOOM_FACTOR)}
      >
        <ZoomInIcon />
      </Button>
      <Button aria-label={t("zoom.reset")} size="icon-sm" title={t("zoom.reset")} variant="ghost" onClick={onReset}>
        <RotateCcwIcon />
      </Button>
    </div>
  );
}

export function ImageZoomStage({
  alt,
  src,
  transform,
  stageRef,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDoubleClick,
}: {
  alt: string;
  src: string;
  transform: ImageTransform;
  stageRef: RefObject<HTMLDivElement | null>;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 touch-none cursor-grab items-center justify-center overflow-hidden bg-muted/40 active:cursor-grabbing"
      ref={stageRef}
      onDoubleClick={onDoubleClick}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <img
        alt={alt}
        className="pointer-events-none block max-h-full max-w-full origin-center select-none object-contain"
        draggable={false}
        src={src}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      />
    </div>
  );
}
