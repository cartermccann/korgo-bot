/**
 * The full Bot plugin registers profile, cron, CLI, image-generation, and
 * integration actions. Those are Mini-owned in the SSH-only SKU, whose safe
 * profile switcher lives in the core sidebar instead.
 */
export default {
  id: 'hermes-bots',
  name: 'Bots',
  defaultEnabled: false,
  register() {}
}
