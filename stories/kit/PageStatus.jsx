// The page's one status, shown at the top of its docs.
import React from "react";
import { statusOf } from "./status.js";

export const PageStatus = ({ page }) => <p className="kanso-docs__status"><span className="kanso-badge">{statusOf(page)}</span></p>;
