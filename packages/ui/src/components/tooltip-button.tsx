// Adaptado da prop `tooltip` do Button de zommehq/shared src/ui/components/ui/button.tsx no commit c15fd2d (os componentes de chat da Skia).
// O Button do Pinar não tem essa prop; este invólucro interno compõe o Tooltip do Pinar sobre o MESMO botão
// (prop `render` do trigger), sem mudar o Button existente. Usado pelo MessageScrollerButton e pelo CodeBlockCopyButton.
import type * as React from "react";
import { Button, type ButtonProps } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

type TooltipButtonProps = ButtonProps & {
  /** Dica exibida ao passar ou focar no botão. Não substitui um `aria-label` próprio. */
  tooltip?: React.ReactNode;
};

function TooltipButton({ tooltip, ...props }: TooltipButtonProps) {
  const button = <Button {...props} />;

  if (tooltip == null || tooltip === false || tooltip === "") {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { TooltipButton, type TooltipButtonProps };
