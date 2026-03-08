export type PluginContext = {
  tenantId: string;
  userId?: string;
  roles?: string[];
};

export type PluginHook =
  | { type: "beforeCreate"; table: string; payload: any }
  | { type: "afterCreate"; table: string; payload: any }
  | { type: "beforeUpdate"; table: string; payload: any }
  | { type: "afterUpdate"; table: string; payload: any };

export type Plugin = {
  id: string;
  name: string;
  enabledByDefault?: boolean;
  onHook?: (ctx: PluginContext, hook: PluginHook) => Promise<void>;
};
