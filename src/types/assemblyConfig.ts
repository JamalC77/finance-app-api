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

// Priority Action
export const PriorityActionSchema = z.object({
  id: z.string(),
  headline: z.string(),
  detail: z.string(),
  dollar_impact: z.string(),
  action: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  linked_section: z.string().optional(),
  linked_detail: z.string().optional(),
  chat_prompt: z.string().optional(),
});
export type PriorityAction = z.infer<typeof PriorityActionSchema>;

// Health Verdict
export const HealthVerdictSchema = z.object({
  status: StatusSchema,
  headline: z.string(),
  sub_line: z.string(),
  priority_actions: z.array(PriorityActionSchema).max(3),
});
export type HealthVerdict = z.infer<typeof HealthVerdictSchema>;

// Runway Week
export const RunwayWeekSchema = z.object({
  week: z.string(),
  balance: z.number(),
  is_danger: z.boolean(),
});
export type RunwayWeek = z.infer<typeof RunwayWeekSchema>;

// Runway Config
export const RunwayConfigSchema = z.object({
  runway_weeks: z.number(),
  runway_label: z.string(),
  status: StatusSchema,
  safety_threshold: z.number(),
  monthly_burn: z.number(),
  min_balance: z.number(),
  min_balance_week: z.string(),
  danger_weeks: z.array(z.string()),
  forecast: z.array(RunwayWeekSchema),
});
export type RunwayConfig = z.infer<typeof RunwayConfigSchema>;

// Top-level Assembly Config
export const AssemblyConfigSchema = z.object({
  health_verdict: HealthVerdictSchema.optional(),
  runway: RunwayConfigSchema.optional(),
  executive_summary: ExecutiveSummarySchema,
  alerts: z.array(AlertConfigSchema),
  sections: z.array(SectionConfigSchema),
  commentary: z.array(CommentaryConfigSchema),
  scenario_defaults: ScenarioDefaultsSchema.optional(),
});
export type AssemblyConfig = z.infer<typeof AssemblyConfigSchema>;
