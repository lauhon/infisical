/* eslint-disable react/no-danger */
import React, { forwardRef, TextareaHTMLAttributes, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import {
  REGEX_SECRET_REFERENCE_FIND,
  REGEX_SECRET_REFERENCE_INVALID
} from "@app/helpers/secret-reference";
import { useToggle } from "@app/hooks";

import SecretReferenceSelect from "./SecretReferenceSelect";

const replaceContentWithDot = (str: string) => {
  let finalStr = "";
  for (let i = 0; i < str.length; i += 1) {
    const char = str.at(i);
    finalStr += char === "\n" ? "\n" : "*";
  }
  return finalStr;
};

const syntaxHighlight = (content?: string | null, isVisible?: boolean) => {
  if (content === "") return "EMPTY";
  if (!content) return "EMPTY";
  if (!isVisible) return replaceContentWithDot(content);

  let skipNext = false;
  const formattedContent = content.split(REGEX_SECRET_REFERENCE_FIND).flatMap((el, i) => {
    const isInterpolationSyntax = el.startsWith("${") && el.endsWith("}");
    if (isInterpolationSyntax) {
      skipNext = true;
      return (
        <span className="ph-no-capture text-yellow" key={`secret-value-${i + 1}`}>
          &#36;&#123;
          <span
            className={twMerge(
              "ph-no-capture text-yellow-200/80",
              REGEX_SECRET_REFERENCE_INVALID.test(el.slice(2, -1)) &&
                "underline decoration-red decoration-wavy"
            )}
          >
            {el.slice(2, -1)}
          </span>
          &#125;
        </span>
      );
    }
    if (skipNext) {
      skipNext = false;
      return [];
    }
    return el;
  });

  // akhilmhdh: Dont remove this br. I am still clueless how this works but weirdly enough
  // when break is added a line break works properly
  return formattedContent.concat(<br />);
};

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value?: string | null;
  isVisible?: boolean;
  isReadOnly?: boolean;
  isDisabled?: boolean;
  containerClassName?: string;
  environment?: string;
  secretPath?: string;
};

const commonClassName = "font-mono text-sm caret-white border-none outline-none w-full break-all";

export const InfisicalSecretInput = forwardRef<HTMLTextAreaElement, Props>(
  (
    {
      value: propValue,
      isVisible,
      containerClassName,
      onBlur,
      isDisabled,
      isReadOnly,
      onFocus,
      secretPath: propSecretPath,
      environment: propEnvironment,
      onChange,
      ...props
    },
    ref
  ) => {
    const childRef = useRef<HTMLTextAreaElement>(null);

    const [isSecretFocused, setIsSecretFocused] = useToggle();
    const [value, setValue] = useState<string>(propValue || "");
    const [showReferencePopup, setShowReferencePopup] = useState<boolean>(false);
    const [referenceKey, setReferenceKey] = useState<string>();
    const [lastCaretPos, setLastCaretPos] = useState<number>(0);

    function isCaretInsideReference(str: string, start: number) {
      const matches = [...str.matchAll(REGEX_SECRET_REFERENCE_FIND)];
      for (let i = 0; i < matches.length; i += 1) {
        const match = matches[i];
        if (
          typeof match?.index !== "undefined" &&
          match.index <= start &&
          start < match.index + match[0].length
        ) {
          return match;
        }
      }
      return null;
    }

    function setCaretPos(caretPos: number) {
      if (childRef?.current) {
        childRef.current.focus();
        setTimeout(() => {
          if (!childRef?.current) return;
          childRef.current.selectionStart = caretPos;
          childRef.current.selectionEnd = caretPos;
        }, 200);
      }
    }

    function referencePopup(text: string, pos: number) {
      const match = isCaretInsideReference(text, pos);
      if (match && typeof match.index !== "undefined") {
        setLastCaretPos(pos);
        setReferenceKey(match?.[2]);
      }
      setShowReferencePopup(!!match);
    }

    function handleReferencePopup(element: HTMLTextAreaElement) {
      const { selectionStart, selectionEnd, value: text } = element;
      if (selectionStart !== selectionEnd || selectionStart === 0) {
        return;
      }
      referencePopup(text, selectionStart);
    }

    function handleKeyUp(event: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === "Escape") {
        setShowReferencePopup(false);
        return;
      }

      if (event.key === "{") {
        // auto close the bracket
        const currCaretPos = event.currentTarget.selectionEnd;
        const isPrevDollar = value[currCaretPos - 2] === "$";
        if (!isPrevDollar) return;

        const newValue = `${value.slice(0, currCaretPos)}}${value.slice(currCaretPos)}`;

        setValue(newValue);
        // TODO: there should be a better way to do
        onChange?.({ target: { value: newValue } } as any);
        setCaretPos(currCaretPos);

        if (event.currentTarget) {
          setTimeout(() => {
            referencePopup(newValue, currCaretPos);
          }, 200);

          return;
        }
      }
      if (!(event.key.startsWith("Arrow") || event.key === "Backspace" || event.key === "Delete")) {
        handleReferencePopup(event.currentTarget);
      }
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (
        !(
          event.key.startsWith("Arrow") ||
          ["Backspace", "Delete", "."].includes(event.key) ||
          (event.metaKey && event.key.toLowerCase() === "a")
        )
      ) {
        const match = isCaretInsideReference(value, event.currentTarget.selectionEnd);
        if (match) event.preventDefault();
      }
    }

    function handleMouseClick(event: React.MouseEvent<HTMLTextAreaElement, MouseEvent>) {
      handleReferencePopup(event.currentTarget);
    }

    async function handleReferenceSelect({
      name,
      type,
      slug
    }: {
      name: string;
      type: "folder" | "secret" | "environment";
      slug?: string;
    }) {
      setShowReferencePopup(false);

      // forward ref for parent component
      if (typeof ref === "function") {
        ref(childRef.current);
      } else if (ref && "current" in ref) {
        const refCopy = ref;
        refCopy.current = childRef.current;
      }

      let newValue = value || "";
      const match = isCaretInsideReference(newValue, lastCaretPos);
      const referenceStartIndex = match?.index || 0;
      const referenceEndIndex = referenceStartIndex + (match?.[0]?.length || 0);
      const [start, oldReference, end] = [
        value.slice(0, referenceStartIndex),
        value.slice(referenceStartIndex, referenceEndIndex),
        value.slice(referenceEndIndex)
      ];

      let oldReferenceStr = oldReference.slice(2, -1);
      let currentPath = type === "environment" ? slug! : name;
      currentPath = currentPath.replace(/\./g, "\\.");

      let replaceReference = "";
      let offset = 3;
      switch (type) {
        case "folder":
          replaceReference = `${oldReferenceStr}${currentPath}.`;
          offset -= 1;
          break;
        case "secret": {
          if (oldReferenceStr.indexOf(".") === -1) oldReferenceStr = "";
          replaceReference = `${oldReferenceStr}${currentPath}`;
          break;
        }
        case "environment":
          replaceReference = `${currentPath}.`;
          offset -= 1;
          break;
        default:
      }
      replaceReference = replaceReference.replace(/[//]/g, "");
      newValue = `${start}$\{${replaceReference}}${end}`;
      setValue(newValue);
      // TODO: there should be a better way to do
      onChange?.({ target: { value: newValue } } as any);
      setShowReferencePopup(type !== "secret");
      setTimeout(() => {
        setIsSecretFocused.on();
        if (type !== "secret") setReferenceKey(replaceReference);
        const caretPos = start.length + replaceReference.length + offset;
        setCaretPos(caretPos);
      }, 100);
    }

    function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
      setValue(event.target.value);
      if (typeof onChange === "function") onChange(event);
    }

    function handleReferenceOpenChange(currOpen: boolean) {
      if (!currOpen) setShowReferencePopup(false);
    }

    return (
      <div
        className={twMerge(
          "flex w-full flex-col overflow-auto rounded-md no-scrollbar",
          containerClassName
        )}
      >
        <div style={{ maxHeight: `${21 * 7}px` }}>
          <div className="relative overflow-hidden">
            <pre aria-hidden className="m-0 ">
              <code className={`inline-block w-full  ${commonClassName}`}>
                <span style={{ whiteSpace: "break-spaces" }}>
                  {syntaxHighlight(value, isVisible || isSecretFocused)}
                </span>
              </code>
            </pre>

            <textarea
              style={{ whiteSpace: "break-spaces" }}
              aria-label="secret value"
              ref={childRef}
              className={twMerge(
                "absolute inset-0 block h-full resize-none overflow-hidden bg-transparent text-transparent no-scrollbar focus:border-0",
                commonClassName
              )}
              onFocus={() => setIsSecretFocused.on()}
              onKeyUp={handleKeyUp}
              onKeyDown={handleKeyDown}
              onClick={handleMouseClick}
              onChange={handleChange}
              disabled={isDisabled}
              spellCheck={false}
              onBlur={(evt) => {
                onBlur?.(evt);
                if (!showReferencePopup) setIsSecretFocused.off();
              }}
              {...props}
              value={value}
              readOnly={isReadOnly}
            />
          </div>
        </div>

        <SecretReferenceSelect
          reference={referenceKey}
          secretPath={propSecretPath}
          environment={propEnvironment}
          open={showReferencePopup}
          handleOpenChange={(isOpen) => handleReferenceOpenChange(isOpen)}
          onSelect={(refValue) => handleReferenceSelect(refValue)}
          onEscapeKeyDown={() => {
            setTimeout(() => {
              setCaretPos(lastCaretPos);
            }, 200);
          }}
        />
      </div>
    );
  }
);

InfisicalSecretInput.displayName = "SecretInput";
