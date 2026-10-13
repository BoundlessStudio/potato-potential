"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { api, demo } from "@/lib/client";
import { ComputerSession } from "@/lib/computer-session";

const Context = createContext<ComputerSession | null>(null);

export function ComputerSessionProvider({
  available,
  onError,
  className,
  style,
  children,
}: Pick<HTMLAttributes<HTMLDivElement>, "className" | "style"> & {
  available: boolean;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const [session] = useState(
    () =>
      new ComputerSession({
        preview: demo,
        createTarget: () => {
          const target = document.createElement("div");
          target.style.width = "100%";
          target.style.height = "100%";
          return target;
        },
        load: async () => {
          const [desktop, module] = await Promise.all([
            api("/computer", "POST"),
            import("@novnc/novnc"),
          ]);
          return { ...desktop, RFB: module.default };
        },
        onError,
      }),
  );

  useEffect(() => {
    const visibility = () => session.setVisible(!document.hidden);
    const online = () => {
      if (!document.hidden) session.setVisible(true);
    };
    visibility();
    session.resume();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      session.dispose();
    };
  }, [session]);

  useEffect(() => session.setAvailable(available), [session, available]);

  return (
    <Context.Provider value={session}>
      <div className={className} style={style}>
        {children}
      </div>
    </Context.Provider>
  );
}

export function useComputerSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Computer requires a workspace session.");
  return session;
}
