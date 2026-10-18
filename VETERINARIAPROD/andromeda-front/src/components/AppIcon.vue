<template>
  <component
    :is="icon"
    class="app-icon"
    :size="size"
    :stroke-width="strokeWidth"
    :aria-hidden="label ? undefined : 'true'"
    :aria-label="label || undefined"
    :role="label ? 'img' : undefined"
  />
</template>

<script setup>
import { computed } from 'vue'
import {
  Activity, AlertTriangle, ArrowRight, Banknote, Bone, Bug, Cake, CircleX, DoorOpen, Droplet, Eye,
  Folder, Heart, List, NotebookPen, Palette, Phone, Pin, Save, Scale, ShoppingCart, Thermometer, Truck,
  Wrench, BadgeCheck, BedDouble, Bell, Boxes, Brain, Building2,
  CalendarCheck, CalendarDays, ChartColumn, ChartLine, ChartPie, Check, ChevronDown, ChevronRight,
  CircleHelp, ClipboardList, Clock, CreditCard, Download, FileText, FlaskConical, HeartPulse, House,
  Info, LayoutDashboard, Lock, LogOut, Mail, Menu, Microscope, Moon, PackageOpen, PawPrint, Pencil,
  Pill, Plus, Receipt, RefreshCw, Scan, Scissors, Search, Send, Settings, ShieldCheck, Sparkles,
  Stethoscope, Sun, Syringe, Trash2, TrendingUp, UserRound, Users, Video, Wallet, X, Zap,
} from 'lucide-vue-next'

// Nombres del dominio → ícono. Las vistas usan estos nombres, nunca el de la librería.
const ICONS = {
  dashboard: LayoutDashboard,
  home: House,
  appointments: CalendarDays,
  calendarCheck: CalendarCheck,
  patients: PawPrint,
  clients: Users,
  user: UserRound,
  evolutions: ClipboardList,
  vaccines: Syringe,
  surgery: Stethoscope,
  hospitalization: BedDouble,
  lab: FlaskConical,
  imaging: Scan,
  pathology: Microscope,
  grooming: Scissors,
  telemedicine: Video,
  ai: Brain,
  inventory: Boxes,
  billing: Receipt,
  payments: Wallet,
  reports: ChartColumn,
  chartLine: ChartLine,
  chartPie: ChartPie,
  trend: TrendingUp,
  admin: Settings,
  notifications: Bell,
  documents: Mail,
  subscription: CreditCard,
  branch: Building2,
  medication: Pill,
  vitals: HeartPulse,
  activity: Activity,
  file: FileText,
  package: PackageOpen,
  sparkles: Sparkles,
  shield: ShieldCheck,
  verified: BadgeCheck,
  lock: Lock,
  zap: Zap,
  clock: Clock,
  search: Search,
  menu: Menu,
  close: X,
  plus: Plus,
  edit: Pencil,
  trash: Trash2,
  check: Check,
  refresh: RefreshCw,
  download: Download,
  send: Send,
  logout: LogOut,
  sun: Sun,
  moon: Moon,
  info: Info,
  warning: AlertTriangle,
  help: CircleHelp,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  arrowRight: ArrowRight,
  deworming: Bug,
  food: Bone,
  tool: Wrench,
  truck: Truck,
  cart: ShoppingCart,
  weight: Scale,
  temperature: Thermometer,
  vet: Stethoscope,
  save: Save,
  note: NotebookPen,
  folder: Folder,
  birthday: Cake,
  color: Palette,
  phone: Phone,
  cash: Banknote,
  cancel: CircleX,
  view: Eye,
  list: List,
  heart: Heart,
  drop: Droplet,
  pin: Pin,
  door: DoorOpen,
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 1.9 },
  label: { type: String, default: '' },
})

const icon = computed(() => ICONS[props.name] || CircleHelp)
</script>

<style scoped>
.app-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
