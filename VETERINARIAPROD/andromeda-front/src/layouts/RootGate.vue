<template>
  <AppLayout v-if="auth.isAuthenticated" />
  <LandingView v-else />
</template>

<script setup>
// "/" muestra la app a quien inició sesión y la página de presentación al resto.
import { defineAsyncComponent } from 'vue'
import { useAuthStore } from '../stores/auth'
import AppLayout from './AppLayout.vue'

const LandingView = defineAsyncComponent(() => import('../views/LandingView.vue'))
const auth = useAuthStore()
</script>
