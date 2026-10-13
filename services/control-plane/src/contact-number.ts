import type { Express, Request } from "express";
import { z } from "zod";
import { phoneSchema, type Agent, type Profile } from "@boundless/shared";
import type { Dependencies } from "./app";
import { HttpError } from "./security";

const normalize = (number: string | undefined) => {
  const parsed = phoneSchema.safeParse(number);
  return parsed.success ? parsed.data : null;
};
const excluded = (agent: Agent, profile: Profile, number: string) =>
  [profile.phone, agent.connect?.number].some(
    (value) => normalize(value) === number,
  );

export function savedContactNumber(agent: Agent, profile: Profile) {
  const saved = agent.contactNumber;
  if (
    !saved ||
    !agent.identityId ||
    saved.identityId !== agent.identityId ||
    saved.recipientNumber !== profile.phone
  )
    return null;
  const number = normalize(saved.number);
  return number && !excluded(agent, profile, number) ? number : null;
}

export const contactNumberUpdateSchema = z
  .object({
    number: phoneSchema.nullable(),
    expectedNumber: phoneSchema.nullable(),
  })
  .strict();

export function applyContactNumberUpdate(
  agent: Agent,
  profile: Profile,
  body: z.infer<typeof contactNumberUpdateSchema>,
) {
  if (!agent.identityId)
    throw new HttpError(
      409,
      "identity_missing",
      "Finish connecting your companion first.",
    );
  if (body.number && excluded(agent, profile, body.number))
    throw new HttpError(
      400,
      "wrong_contact_number",
      "Use your companion’s number from their saved contact card, rather than your own number or the Inkbox connection number.",
    );
  const current = savedContactNumber(agent, profile);
  if (current !== body.expectedNumber && current !== body.number)
    throw new HttpError(
      409,
      "contact_number_changed",
      "This contact number changed elsewhere. Reload it before saving.",
    );
  if (body.number) {
    agent.contactNumber = {
      number: body.number,
      identityId: agent.identityId,
      recipientNumber: profile.phone,
    };
  } else {
    delete agent.contactNumber;
  }
  agent.updatedAt = new Date().toISOString();
}

export function registerContactNumberRoutes(
  app: Express,
  { repo }: Dependencies,
  owner: (req: Request) => string,
  account: (req: Request) => Promise<Profile>,
  ready: (req: Request) => Promise<Agent>,
) {
  app.get("/api/contact-number", async (req, res) => {
    const agent = await ready(req);
    const profile = await account(req);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ number: savedContactNumber(agent, profile) });
  });
  app.put("/api/contact-number", async (req, res) => {
    const body = contactNumberUpdateSchema.parse(req.body);
    const number = await repo.locked(owner(req), async () => {
      const agent = await ready(req);
      const profile = await account(req);
      applyContactNumberUpdate(agent, profile, body);
      await repo.saveAgent(agent);
      return body.number;
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ number });
  });
}
