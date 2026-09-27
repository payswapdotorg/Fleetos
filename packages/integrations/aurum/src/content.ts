/**
 * @fleetos/integration-aurum — D1: derived message content + the typed
 * redaction policy.
 *
 * A communication message's CONTENT is derived deterministically from
 * injected structured inputs — never free text the caller must format.
 * The derived content is a typed record:
 *
 *   - `title` / `summary` — short human-oriented renderings derived
 *     EXCLUSIVELY from the message kind and machine-stable discriminants
 *     (event, severity, surface). By construction they never embed a
 *     value that also appears as a field value, so a redaction policy can
 *     never leak through them (the redaction-soundness invariant, proven
 *     by test: redacting every redactable field leaves title/summary
 *     byte-identical).
 *   - `fields` — the machine-stable structured body: an ordered list of
 *     `{ key, value, sensitivity }` triples rendered by the kind's
 *     template (deterministic order, never input order).
 *
 * The sensitivity classification is part of the adapter's contract:
 *
 *   - `"machine"` — machine-stable enums, statuses, counts, prices and
 *     timestamps. NON-REDACTABLE by construction (a redaction rule that
 *     targets a machine field is refused with the machine-stable reason
 *     `rule_targets_machine_field`); may appear in title/summary.
 *   - `"reference"` — internal FleetOS refs (entity ids, areas,
 *     descriptions). Redactable by field key or by class.
 *   - `"identity"` — identity-bearing values (device ids, principal ids,
 *     vendor ids). Redactable by field key or by class.
 *
 * The redaction policy is a TYPED record applied BEFORE emission: the
 * builder applies it to the derived content, replaces every matched
 * field's value with the stable `REDACTED_VALUE` marker, and records the
 * redacted field keys (sorted, deduplicated) on the intent — the
 * content digest is computed over the POST-redaction content.
 *
 * No runtime dependencies. No `any` in public signatures. Strict TS.
 */

import {
  dedupeSortedStrings,
  frozen,
  frozenArray,
  sortedStrings,
} from "./internal";

// ---------------------------------------------------------------------------
// The derived content model
// ---------------------------------------------------------------------------

/**
 * The sensitivity classification of a content field. Machine fields are
 * non-redactable and may surface in title/summary; reference and identity
 * fields are redactable and NEVER surface in title/summary.
 */
export type ContentSensitivity = "machine" | "reference" | "identity";

/** One machine-stable field of the derived message content. */
export interface ContentField {
  /** Machine-stable field key (unique within one message; template order). */
  readonly key: string;
  /** Deterministic string rendering of the value. */
  readonly value: string;
  /** The sensitivity classification (drives redaction). */
  readonly sensitivity: ContentSensitivity;
}

/** The derived, redaction-sound message content. */
export interface MessageContent {
  /** Derived from the message kind + machine discriminants ONLY. */
  readonly title: string;
  /** Derived from the message kind + machine discriminants ONLY. */
  readonly summary: string;
  /** The structured body, in the kind template's deterministic order. */
  readonly fields: readonly ContentField[];
}

// ---------------------------------------------------------------------------
// The typed redaction policy
// ---------------------------------------------------------------------------

/**
 * One redaction rule. Either targets ONE field by its machine-stable key,
 * or EVERY field of a sensitivity class. A rule that would target a
 * `"machine"` field (by key or by class) is refused — machine fields are
 * public by definition and the title/summary soundness proof depends on
 * their immutability.
 */
export type RedactionRule =
  | { readonly kind: "field"; readonly fieldKey: string }
  | { readonly kind: "sensitivity"; readonly sensitivity: "reference" | "identity" };

/** The typed redaction policy applied to derived content before emission. */
export interface RedactionPolicy {
  readonly rules: readonly RedactionRule[];
}

/** The policy that redacts nothing (the default when none is injected). */
export const NO_REDACTION: RedactionPolicy = frozen({ rules: frozenArray([]) });

/** The stable marker substituted for every redacted field value. */
export const REDACTED_VALUE = "[redacted]" as const;

/** The machine-stable failure reasons of redaction-policy validation. */
export type RedactionPolicyFailureReason =
  | "rules_array_required"
  | "rule_object_required"
  | "unknown_rule_kind"
  | "field_key_required"
  | "unknown_sensitivity"
  | "rule_targets_machine_field";

/**
 * Validate a redaction policy (pure, non-throwing). A rule is invalid
 * when it is not a well-formed rule object, when a `field` rule carries
 * no non-empty key, when a `sensitivity` rule names an unknown class, or
 * when ANY rule targets a machine field — by key (a field rule whose key
 * names a machine field of the content being built) or by class
 * (`sensitivity: "machine"` is not even expressible in the rule type;
 * the runtime check guards type-bypassed callers).
 *
 * @param policy the candidate policy
 * @param content the derived content the policy will be applied to (the
 *   machine-field-key check is content-relative)
 * @returns the failure list (empty = valid)
 */
export function validateRedactionPolicy(
  policy: unknown,
  content: MessageContent,
): { path: string; reason: RedactionPolicyFailureReason }[] {
  const failures: { path: string; reason: RedactionPolicyFailureReason }[] = [];
  if (policy === null || typeof policy !== "object") {
    return [{ path: "/redaction", reason: "rules_array_required" }];
  }
  const candidate = policy as { rules?: unknown };
  if (!Array.isArray(candidate.rules)) {
    return [{ path: "/redaction/rules", reason: "rules_array_required" }];
  }
  const machineKeys = new Set<string>(
    content.fields.filter((f) => f.sensitivity === "machine").map((f) => f.key),
  );
  for (let i = 0; i < candidate.rules.length; i++) {
    const rule = candidate.rules[i];
    const path = `/redaction/rules/${i}`;
    if (rule === null || typeof rule !== "object") {
      failures.push({ path, reason: "rule_object_required" });
      continue;
    }
    const r = rule as { kind?: unknown; fieldKey?: unknown; sensitivity?: unknown };
    if (r.kind === "field") {
      if (typeof r.fieldKey !== "string" || r.fieldKey.length === 0) {
        failures.push({ path: `${path}/fieldKey`, reason: "field_key_required" });
        continue;
      }
      if (machineKeys.has(r.fieldKey)) {
        failures.push({ path, reason: "rule_targets_machine_field" });
      }
    } else if (r.kind === "sensitivity") {
      if (r.sensitivity !== "reference" && r.sensitivity !== "identity") {
        failures.push({ path: `${path}/sensitivity`, reason: "unknown_sensitivity" });
      }
    } else {
      failures.push({ path: `${path}/kind`, reason: "unknown_rule_kind" });
    }
  }
  return failures;
}

/** The result of applying a redaction policy to derived content. */
export interface RedactionResult {
  /** The post-redaction content (fields replaced in place, order kept). */
  readonly content: MessageContent;
  /** The redacted field keys (sorted, deduplicated; empty when none matched). */
  readonly redactedFieldKeys: readonly string[];
}

/**
 * Apply a redaction policy to derived content (pure). Every field matched
 * by any rule (by key or by class) has its value replaced with the stable
 * `REDACTED_VALUE` marker; title/summary are passed through UNCHANGED
 * (they are machine-derived and never embed redactable values — the
 * soundness invariant). Rule order never affects the result: the
 * redacted-key set is sorted + deduplicated, and field replacement is
 * idempotent.
 *
 * The policy is assumed valid (callers validate first with
 * `validateRedactionPolicy`); a type-bypassed machine-targeting rule is
 * ignored here rather than guessed at — validation is the refusal point.
 *
 * @param content the derived content
 * @param policy the redaction policy
 * @returns the post-redaction content + the redacted field keys
 */
export function applyRedaction(content: MessageContent, policy: RedactionPolicy): RedactionResult {
  const redactableByClass = new Set<string>();
  const redactableByKey = new Set<string>();
  for (const rule of policy.rules) {
    if (rule.kind === "field") {
      redactableByKey.add(rule.fieldKey);
    } else {
      redactableByClass.add(rule.sensitivity);
    }
  }
  const redactedKeys: string[] = [];
  const fields = content.fields.map((field): ContentField => {
    const matches =
      redactableByKey.has(field.key) ||
      (field.sensitivity !== "machine" && redactableByClass.has(field.sensitivity));
    if (!matches) return field;
    redactedKeys.push(field.key);
    return frozen({ ...field, value: REDACTED_VALUE });
  });
  return frozen({
    content: frozen({ ...content, fields: frozenArray(fields) }),
    redactedFieldKeys: dedupeSortedStrings(redactedKeys),
  });
}

/**
 * The machine-stable field keys of a content record (sorted). Useful for
 * tests and callers that need to reason about the template surface.
 *
 * @param content the derived content
 * @returns the sorted field keys
 */
export function contentFieldKeys(content: MessageContent): readonly string[] {
  return sortedStrings(content.fields.map((field) => field.key));
}
