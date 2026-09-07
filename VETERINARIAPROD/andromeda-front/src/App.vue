<template>
  <RouterView />
  <AppFeedback />
</template>

<script setup>
import { RouterView } from 'vue-router'
import AppFeedback from './components/AppFeedback.vue'
</script>
