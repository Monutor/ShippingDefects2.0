<script setup>
import { RouterView } from 'vue-router'
import AppTabbar from '@/components/AppTabbar.vue'
import Toast from '@/components/ui/Toast.vue'
</script>

<template>
  <div id="app">
    <RouterView />
    <AppTabbar />
    <Toast />
  </div>
</template>

<style>
#app {
  width: 100%;
  height: auto !important;
}
</style>
