"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

interface SelectProps {
  id: string;
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string; triggerLabel?: string }[];
  contentClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

export function Select({ id, name, value, onValueChange, options, contentClassName, onOpenChange }: SelectProps) {
  const selectedOption = options.find(option => option.value === value);

  return (
    <SelectPrimitive.Root
      name={name}
      value={value}
      onValueChange={onValueChange}
      onOpenChange={onOpenChange}
    >
      <SelectPrimitive.Trigger id={id} className="arcaea-select-trigger" title={selectedOption?.label}>
        <SelectPrimitive.Value>{selectedOption?.triggerLabel ?? selectedOption?.label}</SelectPrimitive.Value>
        <SelectPrimitive.Icon className="arcaea-select-icon">
          <ChevronDown size={15} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={`arcaea-select-content${contentClassName ? ` ${contentClassName}` : ""}`}
          position="popper"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.ScrollUpButton className="arcaea-select-scroll">
            <ChevronUp size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="arcaea-select-viewport">
            {options.map(option => (
              <SelectPrimitive.Item key={option.value} value={option.value} className="arcaea-select-item">
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="arcaea-select-check">
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="arcaea-select-scroll">
            <ChevronDown size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
