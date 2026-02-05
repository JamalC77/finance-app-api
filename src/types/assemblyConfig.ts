import { z } from 'zod';

// Status enum
export const StatusSchema = z.enum(['green', 'yellow', 'red']);
export type Status = z.infer<typeof StatusSchema>;

// Component types enum
export const ComponentTypeSchema = z.enum([
  'KPICard',
  'FlashPNL',
  'JobMarginTracker',
  'CashFlowTiming',
  'WIPSnapshot',
  'BacklogPipeline',
  'MonthlyTrend',
  'ScenarioEngine',
  'Commentary',
]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

// KPI Config
export const KPIConfigSchema = z.object({
  label: z.string(),
  value: z.string(),
  status: StatusSchema,
  trend: z.string().optional(),
  sub_text: z.string().optional(),
});
export type KPIConfig = z.infer<typeof KPIConfigSchema>;

// Alert Config
export const AlertConfigSchema = z.object({
  severity: z.enum(['warning', 'critical', 'info']),
  title: z.string(),
  message: z.string(),
});
export type AlertConfig = z.infer<typeof AlertConfigSchema>;

// Commentary Config
export const CommentaryConfigSchema = z.object({
  date: z.string(),
  author: z.string(),
  note: z.string(),
});
export type CommentaryConfig = z.infer<typeof CommentaryConfigSchema>;

// Scenario defaults
export const ScenarioDefaultsSchema = z.object({
  revenue_change: z.number(),
  margin_change: z.number(),
  delay_weeks: z.number(),
});
export type ScenarioDefaults = z.infer<typeof ScenarioDefaultsSchema>;

// Section Config
export const SectionConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  component: ComponentTypeSchema,
  priority: z.number(),
  badge: z.string().optional(),
  props: z.record(z.any()),
});
export type SectionConfig = z.infer<typeof SectionConfigSchema>;

// Executive Summary
export const ExecutiveSummarySchema = z.object({
  headline: z.string(),
  kpis: z.array(KPIConfigSchema),
});
export type ExecutiveSummary = z.infer<typeof ExecutiveSummarySchema>;

// Top-level Assembly Config
export const AssemblyConfigSchema = z.object({
  executive_summary: ExecutiveSummarySchema,
  alerts: z.array(AlertConfigSchema),
  sections: z.array(SectionConfigSchema),
  commentary: z.array(CommentaryConfigSchema),
  scenario_defaults: ScenarioDefaultsSchema.optional(),
});
export type AssemblyConfig = z.infer<typeof AssemblyConfigSchema>;
