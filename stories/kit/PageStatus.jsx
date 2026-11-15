// The page's one status, shown at the top of its docs.
import React from "react";
import { statusFor } from "./references.js";

export const PageStatus = ({ page }) => <p className="kanso-docs__status"><span className="kanso-badge">{statusFor(page)}</span></p>;
