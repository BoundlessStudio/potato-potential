"use client";
import { useState, type AnchorHTMLAttributes } from "react";
import { demo, request } from "@/lib/client";

export function FileDownloadLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  const [error, setError] = useState("");
  let path = "";
  try {
    const url = new URL(props.href || "", "https://boundless.invalid");
    if (
      url.origin === "https://boundless.invalid" &&
      url.pathname === "/api/files/content"
    )
      path = url.pathname + url.search;
  } catch {
    /* Ordinary external link. */
  }
  return (
    <>
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
        onClick={
          demo && path
            ? (event) => {
                event.preventDefault();
                setError("");
                void request(path.slice(4))
                  .then(async (response) => {
                    const blob = URL.createObjectURL(await response.blob()),
                      link = document.createElement("a");
                    link.href = blob;
                    link.download =
                      new URL(path, window.location.origin).searchParams
                        .get("path")
                        ?.split("/")
                        .pop() || "download";
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(blob), 1000);
                  })
                  .catch((error) => setError(error.message));
              }
            : props.onClick
        }
      />
      {error && (
        <span role="alert" className="error-inline">
          {error}
        </span>
      )}
    </>
  );
}
