import type { Request, Response } from "express";
import { metricsText } from "./prom";

export async function metricsHandler(_req: Request, res: Response) {
  const text = await metricsText();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(text);
}
