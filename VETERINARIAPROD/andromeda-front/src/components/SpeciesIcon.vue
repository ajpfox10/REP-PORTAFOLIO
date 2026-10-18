<template>
  <component
    :is="icon"
    class="species-icon"
    :size="size"
    :stroke-width="1.9"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    :role="label ? 'img' : undefined"
  />
</template>

<script setup>
import { computed } from 'vue'
import { Bird, Cat, Dog, Fish, PawPrint, Rabbit, Rat, Turtle } from 'lucide-vue-next'

// Acepta el nombre común (es/en) o el slug de la especie.
const BY_NAME = {
  perro: Dog, dog: Dog, canino: Dog,
  gato: Cat, cat: Cat, felino: Cat,
  conejo: Rabbit, rabbit: Rabbit,
  ave: Bird, bird: Bird, loro: Bird, canario: Bird,
  pez: Fish, fish: Fish,
  reptil: Turtle, reptile: Turtle, tortuga: Turtle,
  roedor: Rat, rodent: Rat, hamster: Rat, huron: Rat, ferret: Rat,
}

const props = defineProps({
  species: { type: String, default: '' },
  size: { type: [Number, String], default: 18 },
  label: { type: String, default: '' },
})

const icon = computed(() => {
  const key = String(props.species || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return BY_NAME[key] || PawPrint
})
</script>

<style scoped>
.species-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
