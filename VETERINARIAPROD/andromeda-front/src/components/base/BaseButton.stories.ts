import BaseButton from './BaseButton.vue'

export default {
  title: 'Base/BaseButton',
  component: BaseButton,
}

export const Primary = {
  args: {
    variant: 'primary',
  },
  render: (args) => ({
    components: { BaseButton },
    setup: () => ({ args }),
    template: '<BaseButton v-bind="args">Guardar</BaseButton>',
  }),
}
