import { useState } from "react";
import useSWR from "swr";

// ── Design tokens — sourced from get_design_tokens() ─────────────
const tokens = {
  colors: {
    primary:      "#2c7bb6",
    secondary:    "#5aae61",
    surface:      "#f8f9fa",
    border:       "#dee2e6",
    textPrimary:  "#212529",
    textMuted:    "#6c757d",
    error:        "#dc3545",
    success:      "#28a745",
  },
  spacing: {
    xs: "4px", sm: "8px", md: "16px",
    lg: "24px", xl: "32px", xxl: "48px",
  },
  typography: {
    h1:      { fontSize: "2rem",    fontWeight: 600, lineHeight: 1.2 },
    h2:      { fontSize: "1.5rem",  fontWeight: 600, lineHeight: 1.3 },
    h3:      { fontSize: "1.25rem", fontWeight: 500, lineHeight: 1.4 },
    body:    { fontSize: "1rem",    fontWeight: 400, lineHeight: 1.6 },
    caption: { fontSize: "0.875rem",fontWeight: 400, lineHeight: 1.5 },
    label:   { fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.4 },
  },
  borderRadius: "8px",
};

// ── Fetcher utility — standard SWR fetcher for MGnify API ─────────
const fetcher = (url) =>
  fetch(`http://localhost:3000/studies?url=https://www.ebi.ac.uk/metagenomics/api/v1${url}`)
    .then((r) => r.json());

// ── useStudy hook — sourced from get_fetch_pattern("study") ───────
// Field names use MGnify's hyphenated convention from get_endpoint_schema()
function useStudy(accession) {
  const { data, error, isLoading } = useSWR(
    accession ? `/studies/${accession}` : null,
    fetcher
  );
  return {
    study:     data?.data?.attributes,   // e.g. study["study-name"]
    accession: data?.data?.id,
    isLoading,
    error,
  };
}

// ── PageHeader — layout from get_component_spec("PageHeader") ─────
function PageHeader({ title, accession, subtitle }) {
  return (
    <div style={{ marginBottom: tokens.spacing.xl }}>
      <div style={{ display: "flex", alignItems: "center", gap: tokens.spacing.sm, marginBottom: tokens.spacing.xs }}>
        <h1 style={{ ...tokens.typography.h1, margin: 0, color: tokens.colors.textPrimary }}>
          {title}
        </h1>
        <span style={{
          ...tokens.typography.label,
          background: tokens.colors.surface,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: "4px",
          padding: "2px 8px",
          color: tokens.colors.textMuted,
        }}>
          {accession}
        </span>
      </div>
      {subtitle && (
        <p style={{ ...tokens.typography.body, margin: 0, color: tokens.colors.textMuted }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ── MetadataPanel — layout from get_component_spec("MetadataPanel") ─
function MetadataPanel({ fields }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: tokens.spacing.md,
      background: tokens.colors.surface,
      border: `1px solid ${tokens.colors.border}`,
      borderRadius: tokens.borderRadius,
      padding: tokens.spacing.lg,
      marginBottom: tokens.spacing.xl,
    }}>
      {fields.map(({ label, value }) => (
        <div key={label}>
          <div style={{ ...tokens.typography.label, color: tokens.colors.textMuted, marginBottom: "2px" }}>
            {label}
          </div>
          <div style={{ ...tokens.typography.body, color: tokens.colors.textPrimary }}>
            {value ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: tokens.spacing.xl }}>
      <h2 style={{
        ...tokens.typography.h2,
        color: tokens.colors.textPrimary,
        borderBottom: `1px solid ${tokens.colors.border}`,
        paddingBottom: tokens.spacing.sm,
        marginBottom: tokens.spacing.md,
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ── StudyDetailPage ───────────────────────────────────────────────
// Uses exact field names from get_endpoint_schema() output:
//   study-name, study-abstract, samples-count, centre-name,
//   last-update, data-origination, bioproject, accession
export function StudyDetailPage({ accession = "MGYS00005292" }) {
  const { study, accession: id, isLoading, error } = useStudy(accession);

  // ── Loading state ──────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: tokens.spacing.xl, color: tokens.colors.textMuted, ...tokens.typography.body }}>
        Loading study {accession}...
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        padding: tokens.spacing.xl,
        color: tokens.colors.error,
        ...tokens.typography.body,
        background: "#fff5f5",
        borderRadius: tokens.borderRadius,
        border: `1px solid ${tokens.colors.error}`,
      }}>
        Failed to load study. Please try again.
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────
  if (!study) {
    return (
      <div style={{ padding: tokens.spacing.xl, color: tokens.colors.textMuted }}>
        No study found for accession: {accession}
      </div>
    );
  }

  // ── Metadata fields — all field names from get_endpoint_schema() ─
  const metadataFields = [
    { label: "Accession",        value: study["accession"] },
    { label: "Samples",          value: study["samples-count"] },
    { label: "Centre",           value: study["centre-name"] },
    { label: "Data origination", value: study["data-origination"] },
    { label: "Last updated",     value: study["last-update"]
        ? new Date(study["last-update"]).toLocaleDateString()
        : null },
    { label: "BioProject",       value: study["bioproject"] },
  ];

  return (
    <div style={{
      maxWidth: "900px",
      margin: "0 auto",
      padding: tokens.spacing.xl,
      fontFamily: "inherit",
    }}>
      {/* Page header — component spec from get_component_spec("PageHeader") */}
      <PageHeader
        title={study["study-name"]}
        accession={id}
        subtitle={`${study["samples-count"]} samples · ${study["centre-name"] ?? ""}`}
      />

      {/* Metadata grid — component spec from get_component_spec("MetadataPanel") */}
      <Section title="Study details">
        <MetadataPanel fields={metadataFields} />
      </Section>

      {/* Abstract */}
      <Section title="Abstract">
        <p style={{
          ...tokens.typography.body,
          color: tokens.colors.textPrimary,
          lineHeight: 1.7,
          margin: 0,
        }}>
          {study["study-abstract"] ?? "No abstract available."}
        </p>
      </Section>
    </div>
  );
}

export default StudyDetailPage;
