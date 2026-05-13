import { NextResponse } from "next/server";

/**
 * Image upload endpoint — not yet implemented.
 *
 * The frontend paste handler calls this route when the user pastes a screenshot.
 * Returning 501 (Not Implemented) instead of 404 so the error message is clearer
 * and future implementations can replace this stub.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Image upload is not configured in this deployment." },
    { status: 501 }
  );
}
