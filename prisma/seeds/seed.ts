/**
 * Claapo / CrewCall — Massive-Scale Data Seed (100K+ records)
 *
 * Creates:
 *   2,000 Freelancers (individual)  — email: freelancerNNNN@claapo.test   password: Test@1234
 *   1,000 Companies                 — email: companyNNNN@claapo.test      password: Test@1234
 *     500 Vendors                   — email: vendorNNNN@claapo.test       password: Test@1234
 *
 *   + 3,000+ equipment items (for vendors)
 *   + 5,000+ projects (for companies)
 *   + 20,000+ bookings
 *   + 50,000+ messages across conversations
 *   + 10,000+ invoices with line items
 *   + 5,000+ reviews
 *   + 10,000+ notifications
 *   + availability slots
 *   + sub-users
 *
 * Performance:
 *   - Password hashed ONCE, reused for all users
 *   - createMany with batching (batch size 1000)
 *   - skipDuplicates where appropriate
 *   - Expected runtime: under 2 minutes
 *
 * Run:  npx ts-node prisma/seeds/seed.ts
 *       or: npx prisma db seed  (after configuring package.json)
 */

import {
  PrismaClient,
  UserRole,
  VendorType,
  SlotStatus,
  ProjectStatus,
  BookingStatus,
  InvoiceStatus,
  MessageType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'Test@1234';
const BATCH_SIZE = 1000;

// ──────────────────────────────────────────────
// Counts
// ──────────────────────────────────────────────
const NUM_FREELANCERS = 2000;
const NUM_COMPANIES = 1000;
const NUM_VENDORS = 500;
const NUM_PROJECTS = 5000;
const NUM_BOOKINGS_TARGET = 20000;
const NUM_MESSAGES_TARGET = 50000;
const NUM_INVOICES_TARGET = 10000;
const NUM_REVIEWS_TARGET = 5000;
const NUM_NOTIFICATIONS_TARGET = 10000;

// ──────────────────────────────────────────────
// Indian cities & states
// ──────────────────────────────────────────────
const CITIES: { city: string; state: string; lat: number; lng: number }[] = [
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { city: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
  { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { city: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
  { city: 'Goa', state: 'Goa', lat: 15.2993, lng: 74.124 },
  { city: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
];

// Realistic human face avatar URLs from UI Faces / DiceBear / randomuser
// Using i.pravatar.cc which serves real human faces by numeric ID
function avatarUrl(seed: number, gender?: 'men' | 'women'): string {
  // randomuser.me provides real human photos by gender
  if (gender) {
    return `https://randomuser.me/api/portraits/${gender}/${seed % 100}.jpg`;
  }
  // i.pravatar.cc provides random faces by ID
  return `https://i.pravatar.cc/200?img=${(seed % 70) + 1}`;
}

// Company logo URLs using placehold.co with brand initials
function companyLogoUrl(name: string, idx: number): string {
  const colors = ['3B5BDB', 'E94560', '00B894', 'F39C12', '8E44AD', '2C3E50', 'E74C3C', '1ABC9C', 'D35400', '2980B9'];
  const color = colors[idx % colors.length];
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]).join('+').toUpperCase();
  return `https://placehold.co/200x200/${color}/ffffff?text=${initials}&font=montserrat`;
}

const SKILLS = [
  'Director', 'DOP', 'Camera Operator', 'Sound Engineer', 'Gaffer',
  'Makeup Artist', 'Production Designer', 'Editor', 'VFX Artist',
  'Line Producer', 'Art Director', 'Costume Designer', 'Stunt Coordinator',
  'Colorist', 'Script Supervisor', 'Focus Puller', 'Grip', 'Steadicam Operator',
  'Location Manager', 'Casting Director',
];

const GENRES = ['Action', 'Comedy', 'Drama', 'Romance', 'Science Fiction', 'Fantasy', 'Horror', 'Documentary', 'Thriller', 'Fashion', 'Beauty', 'Noir'];

const COMPANY_TYPES = ['Production House', 'Ad Agency', 'OTT Platform', 'Post-Production Studio', 'Content Studio', 'Film Studio'];

const VENDOR_TYPES: VendorType[] = ['equipment', 'lighting', 'transport', 'catering', 'all'];

const EQUIPMENT_IMAGES: Record<string, string[]> = {
  equipment: [
    'https://placehold.co/400x300/1a1a2e/e94560?text=ARRI+Alexa+Mini+LF&font=montserrat',
    'https://placehold.co/400x300/16213e/0f3460?text=RED+V-Raptor&font=montserrat',
    'https://placehold.co/400x300/1a1a2e/e94560?text=Sony+FX6&font=montserrat',
    'https://placehold.co/400x300/16213e/0f3460?text=Canon+C70&font=montserrat',
    'https://placehold.co/400x300/1a1a2e/e94560?text=Blackmagic+URSA&font=montserrat',
    'https://placehold.co/400x300/16213e/0f3460?text=DJI+Ronin+4D&font=montserrat',
    'https://placehold.co/400x300/1a1a2e/e94560?text=Sony+Venice+2&font=montserrat',
  ],
  lighting: [
    'https://placehold.co/400x300/2d3436/dfe6e9?text=ARRI+SkyPanel+S60&font=montserrat',
    'https://placehold.co/400x300/2d3436/dfe6e9?text=Aputure+600d+Pro&font=montserrat',
    'https://placehold.co/400x300/2d3436/dfe6e9?text=Kino+Flo+Celeb&font=montserrat',
    'https://placehold.co/400x300/2d3436/dfe6e9?text=ARRI+M40+HMI&font=montserrat',
    'https://placehold.co/400x300/2d3436/dfe6e9?text=Nanlite+Forza+720&font=montserrat',
    'https://placehold.co/400x300/2d3436/dfe6e9?text=Litepanels+Gemini&font=montserrat',
  ],
  transport: [
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Vanity+Van+20ft&font=montserrat',
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Generator+Truck&font=montserrat',
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Crew+Bus+26-Seat&font=montserrat',
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Camera+Car+SUV&font=montserrat',
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Flatbed+Truck&font=montserrat',
    'https://placehold.co/400x300/0c0c0c/f5f5f5?text=Makeup+Van&font=montserrat',
  ],
  catering: [
    'https://placehold.co/400x300/6c5ce7/dfe6e9?text=Breakfast+%2B+Lunch&font=montserrat',
    'https://placehold.co/400x300/6c5ce7/dfe6e9?text=Full-Day+Catering&font=montserrat',
    'https://placehold.co/400x300/6c5ce7/dfe6e9?text=Craft+Services&font=montserrat',
    'https://placehold.co/400x300/6c5ce7/dfe6e9?text=Premium+Catering&font=montserrat',
    'https://placehold.co/400x300/6c5ce7/dfe6e9?text=Snack+Station&font=montserrat',
  ],
  all: [
    'https://placehold.co/400x300/2d3436/00b894?text=Production+Kit&font=montserrat',
    'https://placehold.co/400x300/2d3436/00b894?text=Studio+Package&font=montserrat',
    'https://placehold.co/400x300/2d3436/00b894?text=Outdoor+Shoot+Kit&font=montserrat',
  ],
};

const EQUIPMENT_NAMES: Record<string, string[]> = {
  equipment: ['ARRI Alexa Mini LF', 'RED V-Raptor', 'Sony FX6', 'Canon C70', 'Blackmagic URSA Mini Pro', 'DJI Ronin 4D', 'Sony Venice 2'],
  lighting: ['ARRI SkyPanel S60', 'Aputure 600d Pro', 'Kino Flo Celeb 450', 'ARRI M40 HMI', 'Nanlite Forza 720', 'Litepanels Gemini 2x1'],
  transport: ['Vanity Van 20ft', 'Generator Truck 125kVA', 'Crew Bus 26-Seater', 'Camera Car SUV', 'Flatbed Truck 10T', 'Makeup Van'],
  catering: ['Breakfast + Lunch Package', 'Full-Day Catering (50 pax)', 'Craft Services Setup', 'Premium Catering (100 pax)', 'Snack & Beverage Station'],
  all: ['Production Kit Bundle', 'Studio Package (Sound + Light)', 'Outdoor Shoot Kit'],
};

const PROJECT_TITLES = [
  'Whispers of Mumbai', 'Neon Nights Delhi', 'The Last Frame', 'Beyond the Lens',
  'Monsoon Diaries', 'City of Dreams', 'The Sound Within', 'Shutter Island Remake',
  'Golden Hour', 'Silk Road Tales', 'Echoes of Bangalore', 'The Art of Silence',
  'Fragments', 'Rise of the Phoenix', 'Crimson Tide India', 'The Great Indian Story',
  "Ocean's Edge", 'Midnight Express Kolkata', 'The Color Purple Redux', 'Starlight Serenade',
  'Dusk Till Dawn', 'The Forgotten Path', 'Shadows of Calcutta', 'Into the Wild India',
  'The Alchemist Chronicles', 'Rogue Wave Mumbai', 'Parallel Lives', 'The Glass House',
  'Sapphire Skies', 'Electric Dreams Chennai', 'The Silent Revolution', 'Beyond Borders',
  'Canvas of Time', 'Desert Mirage', 'The Iron Gate', 'Under the Banyan',
  'Twilight in Goa', 'The Perfume Trail', 'Rebel Hearts', 'Monsoon Wedding Revisited',
  'Cityscape', 'Emerald Valley', 'The Paper Trail', 'Northern Lights India',
  'Rhythm of the Streets', 'The Underground', 'Silver Lining', 'Vintage Bollywood',
  'The Bridge', 'Wild Orchids', 'Broken Mirrors', 'The Artisan',
  'Fireflies', 'Ocean Breeze', 'The Nomad', 'Urban Jungle',
  'Hidden Treasures', 'The Last Sunset', 'Wanderlust India', 'Storm Chasers',
];

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Sai', 'Arnav', 'Dhruv', 'Kabir',
  'Ananya', 'Diya', 'Myra', 'Sara', 'Aadhya', 'Isha', 'Kiara', 'Riya', 'Priya', 'Neha',
  'Rohit', 'Vikram', 'Karan', 'Nikhil', 'Raj', 'Amit', 'Sanjay', 'Manish', 'Rakesh', 'Deepak',
  'Pooja', 'Shruti', 'Meera', 'Nandini', 'Kavita', 'Sneha', 'Tanvi', 'Ritika', 'Swati', 'Anjali',
  'Yash', 'Parth', 'Dev', 'Ishaan', 'Rohan', 'Arun', 'Varun', 'Harsh', 'Kunal', 'Rahul',
  'Simran', 'Divya', 'Kriti', 'Sanya', 'Tara', 'Mira', 'Zara', 'Aisha', 'Rhea', 'Naina',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Verma', 'Reddy', 'Joshi', 'Nair', 'Iyer',
  'Desai', 'Chatterjee', 'Mukherjee', 'Pillai', 'Rao', 'Menon', 'Bhat', 'Kapoor', 'Malhotra', 'Chopra',
];

const COMPANY_NAMES = [
  'Dharma Productions', 'Red Chillies Entertainment', 'Yash Raj Films', 'Excel Entertainment',
  'Phantom Films', 'Eros International', 'UTV Motion Pictures', 'Balaji Motion Pictures',
  'Viacom18 Studios', 'Zee Studios', 'Aamir Khan Productions', 'Maddock Films',
  'Colour Yellow', 'Clean Slate Filmz', 'T-Series Films', 'Lyca Productions',
  'Sun Pictures', 'Hombale Films', 'DVV Entertainment', 'Geetha Arts',
  'Reliance Entertainment', 'Fox Star Studios India', 'PVR Pictures',
  'Cinestaan', 'Abundantia Entertainment', 'RSVP Movies', 'Sikhya Entertainment',
  'Matchbox Pictures', 'Applause Entertainment', 'Roy Kapur Films',
  'Kyta Productions', 'Vinod Chopra Films', 'Nadiadwala Grandson', 'Luv Films',
  'Window Seat Films', 'Azure Entertainment', 'Tips Industries', 'Panorama Studios',
  'NH Studioz', 'Pen Studios', 'Star Studios India', 'Junglee Pictures',
  'Prime Focus', 'Emmay Entertainment', 'Anil Kapoor Films', 'Sanjay Leela Bhansali Films',
  'Bhushan Kumar Films', 'Cape of Good Films', 'Ellipsis Entertainment', 'Contiloe Entertainment',
  'Flying Unicorn', 'Pocket Aces', 'Terribly Tiny Tales', 'The Viral Fever',
  'BankRoll Films', 'Luv Ranjan Films', 'TSeries Originals', 'Wunderbar Films',
  'Thenandal Studios', 'Dream Warrior Pictures',
];

const VENDOR_NAMES = [
  'CineGear India', 'Arri India Rentals', 'Red Digital Cinema India', 'VR Mumbai Cine Services',
  'ShootPro Equipment', 'LightCraft Studios', 'Zoom Communications', 'GripPro India',
  'Star Catering Services', 'Mumbai Transport Hub', 'CineLights Pro', 'SoundStage India',
  'Lens & Light Rentals', 'Prime Focus Rentals', 'Film Equipment Corp', 'Action Camera India',
  'Dolby Lighting Solutions', 'SetCraft Productions', 'Pro Audio India', 'CineKit Express',
  'Camera House Mumbai', 'Studio Light Works', 'FilmGear Logistics', 'Cine Catering Co',
  'Bombay Equipment House', 'South India Cine Supply', 'Lens Master Delhi', 'HydLight Studios',
  'Chennai Film Services', 'Pune Cine Rentals', 'Kolkata Film Supply', 'Ahmedabad Studio',
  'Jaipur Light House', 'Goa Film Services', 'Kochi Cine Equipment', 'Bangalore Grip House',
  'Steadicam India', 'Drone India Aerial', 'VFX Hardware Hub', 'Post Pro Equipment',
  'FilmCraft Vanity', 'Green Room Catering', 'On-Set Catering India', 'Unit Movers India',
  'Cine Transport Services', 'Generator Pro India', 'Power House Rentals', 'Quick Set Lighting',
  'Royal Catering Mumbai', 'Elite Production Vehicles', 'Super Cine Transport', 'Flash Lighting India',
  'BrightStar Equipment', 'CineVan India', 'Premier Film Services', 'Atlas Cine Rentals',
  'Omega Lighting Co', 'Delta Transport Hub', 'Alpha Catering Co', 'Nova Equipment House',
];

const CHAT_MESSAGES = [
  'Hi, when can we schedule the pre-production meeting?',
  'The equipment will be delivered by Thursday.',
  'Looking forward to the shoot!',
  'Can we discuss the schedule and deliverables?',
  'Sure, let me check my availability for those dates.',
  'The rate works for me. Let me know the next steps.',
  'Great! I will send you the detailed brief shortly.',
  'Do you have any specific equipment requirements?',
  'I can start from the mentioned date. Please confirm.',
  'Hi! Thanks for considering me for this project.',
  'Looking forward to working together!',
  'What is the expected duration of the shoot?',
  'I have some availability conflicts in the second week.',
  'Can we adjust the call sheet for outdoor scenes?',
  'The location recce is scheduled for next Monday.',
  'Please share the script breakdown at your convenience.',
  'We need to finalize the crew list by Friday.',
  'The costume fittings are confirmed for Tuesday.',
  'Is there parking available at the shooting location?',
  'The generator will be on standby from 6 AM.',
  'Can we get an extra monitor for the director?',
  'Hair and makeup team needs a separate room.',
  'The drone shots are scheduled for golden hour.',
  'We might need overtime on the last day of shoot.',
  'The catering team needs a headcount by tomorrow.',
  'I have sent the invoice for the first milestone.',
  'The color grading session is booked for next week.',
  'Can you share the call sheet for Day 3?',
  'The talent has confirmed availability for all dates.',
  'We need to arrange a vanity van for the lead actors.',
  'Post-production will begin immediately after wrap.',
  'The DIT station needs to be set up before sunrise.',
  'Can we get walkie-talkies for the entire crew?',
  'The art department needs access to the set by 5 AM.',
  'Sound check is mandatory before the first take.',
  'The stunt coordinator has reviewed the action sequences.',
  'We have backup generators arranged for the night shoot.',
  'The production design mood board is approved.',
  'Please ensure all NDAs are signed before the shoot.',
  'The dailies will be reviewed every evening at 8 PM.',
  'Transport for the crew is arranged from Film City.',
  'The focus puller needs lens charts for all cameras.',
  'Craft services should include vegetarian options.',
  'The steadicam rig needs calibration before the shot.',
  'Can we schedule a rehearsal before the emotional scene?',
  'The lighting setup for the night scene needs 4 hours.',
  'All releases from extras need to be collected on set.',
  'The editor will start assembling the rough cut tomorrow.',
  'We need rain machines for the climax sequence.',
  'The sound recordist has requested boom operator support.',
];

const REVIEW_TEXTS = [
  'Excellent work, very professional and punctual.',
  'Great experience working together. Highly recommended!',
  'Delivered exactly what was discussed. Will hire again.',
  'Very talented and easy to work with.',
  'Good work overall but communication could be better.',
  'Outstanding quality, exceeded expectations.',
  'Reliable and dedicated professional.',
  'The final output was beyond our expectations.',
  'Met all deadlines. Great attention to detail.',
  'Skilled professional who understands the craft.',
  'A pleasure to collaborate with on this project.',
  'Brought creative ideas that elevated the project.',
  'Top-notch equipment and service quality.',
  'Would definitely work with them again in the future.',
  'Very responsive and accommodating with schedule changes.',
];

const NOTIFICATION_TYPES = [
  { type: 'booking_request', title: 'New Booking Request', body: 'You have a new booking request for a project.' },
  { type: 'booking_accepted', title: 'Booking Accepted', body: 'Your booking request has been accepted.' },
  { type: 'booking_declined', title: 'Booking Declined', body: 'Your booking request has been declined.' },
  { type: 'invoice_sent', title: 'Invoice Received', body: 'A new invoice has been sent to you.' },
  { type: 'invoice_paid', title: 'Invoice Paid', body: 'Your invoice has been paid.' },
  { type: 'project_update', title: 'Project Update', body: 'There is an update on your project.' },
  { type: 'message_received', title: 'New Message', body: 'You have received a new message.' },
  { type: 'booking_locked', title: 'Booking Locked', body: 'Your booking has been locked and confirmed.' },
  { type: 'review_received', title: 'New Review', body: 'You have received a new review.' },
  { type: 'project_completed', title: 'Project Completed', body: 'A project you were part of has been completed.' },
];

const BOOKING_MESSAGES = [
  "We'd love to have you on board for this project.",
  'Your portfolio impressed us. Would you be available?',
  'We need your expertise for an upcoming production.',
  'Interested in collaborating on this film project.',
  'Your work on the previous project was outstanding. Join us again?',
  'We are looking for experienced crew. Would love to work with you.',
  'This project aligns well with your skills. Let us discuss.',
  'We have an exciting opportunity for you.',
  'Your rates fit our budget. Can we discuss the project?',
  'We were referred to you by a colleague. Interested?',
];

const LINE_ITEM_DESCRIPTIONS = [
  'Professional fees', 'Equipment rental', 'Travel allowance', 'Post-production work',
  'Overtime charges', 'Setup and breakdown', 'Consultation fees', 'Material costs',
  'Transportation charges', 'Per diem allowance', 'Special effects work', 'Color grading',
  'Sound mixing', 'Location scouting', 'Pre-production planning',
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function padNum(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

function uniquePhone(index: number): string {
  // Generates unique 10-digit Indian phone numbers: +91 followed by 10 digits
  // Starting digit 6-9, remaining digits from index to guarantee uniqueness
  const prefix = 6 + (index % 4); // 6, 7, 8, or 9
  const number = String(index).padStart(9, '0');
  return `+91${prefix}${number}`;
}

function randomRate(): { min: number; max: number } {
  const min = (Math.floor(Math.random() * 30) + 5) * 100_00; // 500-3500 INR in paise
  const max = min + (Math.floor(Math.random() * 20) + 5) * 100_00;
  return { min, max };
}

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d;
}

function randomDateBetween(start: Date, end: Date): Date {
  const s = start.getTime();
  const e = end.getTime();
  return new Date(s + Math.random() * (e - s));
}

/** Batch an array into chunks */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function elapsed(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

// ──────────────────────────────────────────────
// Main seed
// ──────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  console.log('Hashing default password (once)...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);
  console.log(`  Password hashed in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 0. Wipe all existing data
  // ─────────────────────────────────────────
  console.log('\nCleaning existing data...');
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.review.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoiceAttachment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.bookingRequest.deleteMany();
  await prisma.projectRole.deleteMany();
  await prisma.subUserProjectAssignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.availabilitySlot.deleteMany();
  await prisma.vendorEquipmentAvailability.deleteMany();
  await prisma.vendorEquipment.deleteMany();
  await prisma.portfolioItem.deleteMany();
  await prisma.individualProfile.deleteMany();
  await prisma.companyProfile.deleteMany();
  await prisma.vendorProfile.deleteMany();
  await prisma.otpSession.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  console.log(`  Data cleaned in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 1. Pre-generate all UUIDs
  // ─────────────────────────────────────────
  console.log('\nPre-generating UUIDs...');
  const freelancerIds: string[] = Array.from({ length: NUM_FREELANCERS }, () => randomUUID());
  const companyIds: string[] = Array.from({ length: NUM_COMPANIES }, () => randomUUID());
  const vendorIds: string[] = Array.from({ length: NUM_VENDORS }, () => randomUUID());

  // ─────────────────────────────────────────
  // 2. Create Users (all roles) with createMany
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_FREELANCERS} freelancers...`);
  const freelancerUsers = freelancerIds.map((id, i) => ({
    id,
    email: `freelancer${padNum(i + 1)}@claapo.test`,
    phone: uniquePhone(i + 1),
    passwordHash,
    role: UserRole.individual as UserRole,
    isVerified: true,
    isActive: true,
  }));
  for (const batch of chunk(freelancerUsers, BATCH_SIZE)) {
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Freelancer users created in ${elapsed(t0)}`);

  console.log(`Creating ${NUM_COMPANIES} companies...`);
  const companyUsers = companyIds.map((id, i) => ({
    id,
    email: `company${padNum(i + 1)}@claapo.test`,
    phone: uniquePhone(10000 + i + 1),
    passwordHash,
    role: UserRole.company as UserRole,
    isVerified: true,
    isActive: true,
  }));
  for (const batch of chunk(companyUsers, BATCH_SIZE)) {
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Company users created in ${elapsed(t0)}`);

  console.log(`Creating ${NUM_VENDORS} vendors...`);
  const vendorUsers = vendorIds.map((id, i) => ({
    id,
    email: `vendor${padNum(i + 1)}@claapo.test`,
    phone: uniquePhone(20000 + i + 1),
    passwordHash,
    role: UserRole.vendor as UserRole,
    isVerified: true,
    isActive: true,
  }));
  for (const batch of chunk(vendorUsers, BATCH_SIZE)) {
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Vendor users created in ${elapsed(t0)}`);

  // Admin user
  console.log('Creating admin user...');
  const adminId = randomUUID();
  await prisma.user.createMany({
    data: [{
      id: adminId,
      email: 'admin@claapo.test',
      phone: uniquePhone(99999),
      passwordHash,
      role: UserRole.admin,
      isVerified: true,
      isActive: true,
    }],
    skipDuplicates: true,
  });
  console.log(`  Admin user created: admin@claapo.test / Test@1234`);

  // ─────────────────────────────────────────
  // 3. Individual Profiles
  // ─────────────────────────────────────────
  console.log('\nCreating individual profiles...');
  const individualProfiles = freelancerIds.map((userId, i) => {
    const loc = CITIES[i % CITIES.length];
    const fname = FIRST_NAMES[i % FIRST_NAMES.length];
    const lname = LAST_NAMES[i % LAST_NAMES.length];
    const displayName = `${fname} ${lname} ${i + 1}`;
    const skills = pickN(SKILLS, Math.floor(Math.random() * 3) + 1);
    const rate = randomRate();
    // Alternate between men/women portraits for realistic avatars
    const gender = i % 2 === 0 ? 'men' as const : 'women' as const;
    return {
      userId,
      displayName,
      bio: `${displayName} is a professional ${skills[0]} based in ${loc.city}.`,
      aboutMe: `With ${Math.floor(Math.random() * 15) + 2} years of experience in the film industry, specializing in ${skills.join(', ')}. Available for freelance projects across India.`,
      skills,
      genre: pick(GENRES),
      locationCity: loc.city,
      locationState: loc.state,
      lat: loc.lat + (Math.random() - 0.5) * 0.1,
      lng: loc.lng + (Math.random() - 0.5) * 0.1,
      dailyRateMin: rate.min,
      dailyRateMax: rate.max,
      isAvailable: i % 5 !== 0,
      avatarKey: avatarUrl(i, gender),
      imdbUrl: i < 200 ? `https://www.imdb.com/name/nm${1000000 + i}` : null,
      instagramUrl: i < 500 ? `https://instagram.com/${fname.toLowerCase()}${lname.toLowerCase()}${i}` : null,
      panNumber: i < 1000 ? `ABCDE${String(1000 + i).slice(0, 4)}F` : null,
      bankAccountName: i < 1000 ? displayName : null,
      bankAccountNumber: i < 1000 ? `${10000000000 + i}` : null,
      ifscCode: i < 1000 ? 'HDFC0001234' : null,
      bankName: i < 1000 ? 'HDFC Bank' : null,
    };
  });
  for (const batch of chunk(individualProfiles, BATCH_SIZE)) {
    await prisma.individualProfile.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Individual profiles created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 4. Company Profiles
  // ─────────────────────────────────────────
  console.log('Creating company profiles...');
  const companyProfiles = companyIds.map((userId, i) => {
    const loc = CITIES[i % CITIES.length];
    const companyName = i < COMPANY_NAMES.length ? COMPANY_NAMES[i] : `Production House ${i + 1}`;
    const compType = pick(COMPANY_TYPES);
    return {
      userId,
      companyName,
      companyType: compType,
      locationCity: loc.city,
      locationState: loc.state,
      bio: `${companyName} is a leading ${compType.toLowerCase()} based in ${loc.city}.`,
      aboutUs: `Founded in ${2000 + (i % 24)}, ${companyName} has produced over ${10 + i * 2} films and commercials.`,
      website: `https://${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      instagramUrl: `https://instagram.com/${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      gstNumber: i < 700 ? `${String(i % 36 + 1).padStart(2, '0')}AABCT${String(1000 + i).slice(0, 4)}Q1Z${i % 10}` : null,
      isGstVerified: i < 500,
      panNumber: `AABCT${String(1000 + i).slice(0, 4)}Q`,
      address: `Floor ${i % 10 + 1}, Tower ${String.fromCharCode(65 + i % 3)}, Film City Complex, ${loc.city}, ${loc.state} - ${400000 + i}`,
      logoKey: companyLogoUrl(companyName, i),
    };
  });
  for (const batch of chunk(companyProfiles, BATCH_SIZE)) {
    await prisma.companyProfile.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Company profiles created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 5. Vendor Profiles
  // ─────────────────────────────────────────
  console.log('Creating vendor profiles...');
  const vendorProfiles = vendorIds.map((userId, i) => {
    const loc = CITIES[i % CITIES.length];
    const vendorName = i < VENDOR_NAMES.length ? VENDOR_NAMES[i] : `Vendor Services ${i + 1}`;
    const vendorType = VENDOR_TYPES[i % VENDOR_TYPES.length];
    return {
      userId,
      companyName: vendorName,
      vendorType,
      locationCity: loc.city,
      locationState: loc.state,
      bio: `${vendorName} offers premium ${vendorType === 'all' ? 'production' : vendorType} services in ${loc.city} and across India.`,
      aboutUs: `Established in ${2005 + (i % 18)}, we serve top production houses with high-quality ${vendorType} solutions.`,
      website: `https://${vendorName.toLowerCase().replace(/[^a-z0-9]/g, '')}.in`,
      instagramUrl: `https://instagram.com/${vendorName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      gstNumber: i < 350 ? `${String(i % 36 + 1).padStart(2, '0')}AABCV${String(2000 + i).slice(0, 4)}Q1Z${i % 10}` : null,
      isGstVerified: i < 250,
      address: `Unit ${i + 1}, Industrial Area Phase ${(i % 4) + 1}, ${loc.city}, ${loc.state} - ${500000 + i}`,
      logoKey: companyLogoUrl(vendorName, i + 100),
    };
  });
  for (const batch of chunk(vendorProfiles, BATCH_SIZE)) {
    await prisma.vendorProfile.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  Vendor profiles created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 6. Vendor Equipment (6-7 per vendor = 3000+)
  // ─────────────────────────────────────────
  console.log('\nCreating vendor equipment (3000+)...');
  const equipmentRecords: {
    id: string;
    vendorUserId: string;
    name: string;
    description: string;
    imageUrl: string;
    currentCity: string;
    dailyRateMin: number;
    dailyRateMax: number;
  }[] = [];

  for (let i = 0; i < NUM_VENDORS; i++) {
    const vendorType = VENDOR_TYPES[i % VENDOR_TYPES.length];
    const eqNames = EQUIPMENT_NAMES[vendorType] ?? EQUIPMENT_NAMES.equipment;
    const eqImages = EQUIPMENT_IMAGES[vendorType] ?? EQUIPMENT_IMAGES.equipment;
    // 6-7 items per vendor to reach 3000+
    const count = Math.min(eqNames.length, 6 + (i % 2));

    for (let j = 0; j < count; j++) {
      const rate = randomRate();
      equipmentRecords.push({
        id: randomUUID(),
        vendorUserId: vendorIds[i],
        name: `${eqNames[j % eqNames.length]} #${i * 10 + j}`,
        description: `Professional-grade ${eqNames[j % eqNames.length]} available for daily rental.`,
        imageUrl: eqImages[j % eqImages.length],
        currentCity: CITIES[(i + j) % CITIES.length].city,
        dailyRateMin: rate.min,
        dailyRateMax: rate.max,
      });
    }
  }
  for (const batch of chunk(equipmentRecords, BATCH_SIZE)) {
    await prisma.vendorEquipment.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${equipmentRecords.length} equipment items created in ${elapsed(t0)}`);

  // Build a quick lookup: vendorId -> equipmentIds
  const vendorEquipmentMap = new Map<string, string[]>();
  for (const eq of equipmentRecords) {
    const list = vendorEquipmentMap.get(eq.vendorUserId) || [];
    list.push(eq.id);
    vendorEquipmentMap.set(eq.vendorUserId, list);
  }

  // ─────────────────────────────────────────
  // 7. Availability Slots
  // ─────────────────────────────────────────
  console.log('\nCreating availability slots...');
  const slotData: {
    userId: string;
    date: Date;
    status: SlotStatus;
    notes: string | null;
  }[] = [];

  // 500 freelancers, 20 days each
  for (let i = 0; i < 500; i++) {
    for (let d = -5; d <= 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      date.setHours(0, 0, 0, 0);
      const status: SlotStatus = d < -2 ? 'past_work' : d < 0 ? 'booked' : (Math.random() > 0.2 ? 'available' : 'blocked');
      slotData.push({ userId: freelancerIds[i], date, status, notes: status === 'blocked' ? 'Personal day' : null });
    }
  }
  // 200 vendors, 15 days each
  for (let i = 0; i < 200; i++) {
    for (let d = 0; d <= 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      date.setHours(0, 0, 0, 0);
      const status: SlotStatus = Math.random() > 0.15 ? 'available' : 'blocked';
      slotData.push({ userId: vendorIds[i], date, status, notes: null });
    }
  }
  for (const batch of chunk(slotData, BATCH_SIZE)) {
    await prisma.availabilitySlot.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${slotData.length} availability slots created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 8. Projects (5000)
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_PROJECTS} projects...`);
  const projectStatuses: ProjectStatus[] = ['active', 'open', 'draft', 'completed', 'cancelled'];
  const projectIds: string[] = [];
  const projectRecords: {
    id: string;
    companyUserId: string;
    title: string;
    productionHouseName: string;
    description: string;
    startDate: Date;
    endDate: Date;
    locationCity: string;
    budgetMin: number;
    budgetMax: number;
    status: ProjectStatus;
  }[] = [];

  for (let i = 0; i < NUM_PROJECTS; i++) {
    const id = randomUUID();
    projectIds.push(id);
    const companyIdx = i % NUM_COMPANIES;
    const loc = CITIES[i % CITIES.length];
    const titleIdx = i % PROJECT_TITLES.length;
    const startOffset = i < 3000 ? -(Math.floor(Math.random() * 60) + 5) : (Math.floor(Math.random() * 30) + 5);
    const duration = Math.floor(Math.random() * 30) + 10;
    const rate = randomRate();

    const companyName = companyIdx < COMPANY_NAMES.length ? COMPANY_NAMES[companyIdx] : `Production House ${companyIdx + 1}`;

    projectRecords.push({
      id,
      companyUserId: companyIds[companyIdx],
      title: `${PROJECT_TITLES[titleIdx]} ${Math.floor(i / PROJECT_TITLES.length) + 1}`,
      productionHouseName: companyName,
      description: `A ${pick(GENRES).toLowerCase()} production shooting in ${loc.city}. An unforgettable cinematic experience.`,
      startDate: futureDate(startOffset),
      endDate: futureDate(startOffset + duration),
      locationCity: loc.city,
      budgetMin: rate.min * 10,
      budgetMax: rate.max * 10,
      status: projectStatuses[i % projectStatuses.length],
    });
  }
  for (const batch of chunk(projectRecords, BATCH_SIZE)) {
    await prisma.project.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${NUM_PROJECTS} projects created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 9. Project Roles (2-4 per project)
  // ─────────────────────────────────────────
  console.log('Creating project roles...');
  const projectRoleRecords: {
    id: string;
    projectId: string;
    roleName: string;
    qty: number;
    rateMin: number;
    rateMax: number;
  }[] = [];

  // For booking assignment we need project -> roles lookup
  const projectRoleMap = new Map<string, { id: string; roleName: string }[]>();

  for (let i = 0; i < NUM_PROJECTS; i++) {
    const numRoles = Math.floor(Math.random() * 3) + 2;
    const roleNames = pickN(SKILLS, numRoles);
    const rate = randomRate();
    const roles: { id: string; roleName: string }[] = [];
    for (const roleName of roleNames) {
      const roleId = randomUUID();
      roles.push({ id: roleId, roleName });
      projectRoleRecords.push({
        id: roleId,
        projectId: projectIds[i],
        roleName,
        qty: Math.floor(Math.random() * 3) + 1,
        rateMin: rate.min,
        rateMax: rate.max,
      });
    }
    projectRoleMap.set(projectIds[i], roles);
  }
  for (const batch of chunk(projectRoleRecords, BATCH_SIZE)) {
    await prisma.projectRole.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${projectRoleRecords.length} project roles created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 10. Bookings (20,000+)
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_BOOKINGS_TARGET}+ bookings...`);
  const bookingStatuses: BookingStatus[] = ['accepted', 'locked', 'pending', 'accepted', 'declined', 'locked', 'pending', 'accepted', 'cancel_requested', 'accepted'];

  const bookingRecords: {
    id: string;
    projectId: string;
    requesterUserId: string;
    targetUserId: string;
    projectRoleId: string | null;
    vendorEquipmentId: string | null;
    status: BookingStatus;
    rateOffered: number;
    message: string;
    respondedAt: Date | null;
    lockedAt: Date | null;
    cancelRequestReason: string | null;
    cancelRequestedAt: Date | null;
  }[] = [];

  // Track bookings for conversations/reviews/invoices
  const bookingMeta: { id: string; projectId: string; requesterId: string; targetId: string; status: BookingStatus }[] = [];

  // Crew bookings: distribute across projects
  // ~16,000 crew bookings (3-4 per project across 5000 projects)
  const crewBookingTarget = Math.floor(NUM_BOOKINGS_TARGET * 0.8);
  let crewCount = 0;
  for (let p = 0; p < NUM_PROJECTS && crewCount < crewBookingTarget; p++) {
    const projectId = projectIds[p];
    const companyIdx = p % NUM_COMPANIES;
    const roles = projectRoleMap.get(projectId) || [];
    const numBookings = Math.floor(Math.random() * 3) + 3; // 3-5

    for (let b = 0; b < numBookings && crewCount < crewBookingTarget; b++) {
      const freelancerIdx = (p * 5 + b) % NUM_FREELANCERS;
      const role = roles[b % roles.length];
      const status = bookingStatuses[(p + b) % bookingStatuses.length];
      const rate = randomRate();
      const bookingId = randomUUID();

      bookingRecords.push({
        id: bookingId,
        projectId,
        requesterUserId: companyIds[companyIdx],
        targetUserId: freelancerIds[freelancerIdx],
        projectRoleId: role?.id ?? null,
        vendorEquipmentId: null,
        status,
        rateOffered: rate.min,
        message: BOOKING_MESSAGES[(p + b) % BOOKING_MESSAGES.length],
        respondedAt: ['accepted', 'declined', 'locked'].includes(status) ? pastDate(Math.floor(Math.random() * 30)) : null,
        lockedAt: status === 'locked' ? pastDate(Math.floor(Math.random() * 15)) : null,
        cancelRequestReason: status === 'cancel_requested' ? 'Schedule conflict with another project' : null,
        cancelRequestedAt: status === 'cancel_requested' ? pastDate(Math.floor(Math.random() * 5)) : null,
      });
      bookingMeta.push({ id: bookingId, projectId, requesterId: companyIds[companyIdx], targetId: freelancerIds[freelancerIdx], status });
      crewCount++;
    }
  }

  // Vendor bookings: ~4000+
  const vendorBookingTarget = NUM_BOOKINGS_TARGET - crewCount;
  let vendorBookingCount = 0;
  for (let p = 0; p < NUM_PROJECTS && vendorBookingCount < vendorBookingTarget; p++) {
    const projectId = projectIds[p];
    const companyIdx = p % NUM_COMPANIES;
    const vendorIdx = p % NUM_VENDORS;
    const vendorEqList = vendorEquipmentMap.get(vendorIds[vendorIdx]) || [];
    const status = bookingStatuses[(p + 3) % bookingStatuses.length];
    const bookingId = randomUUID();

    bookingRecords.push({
      id: bookingId,
      projectId,
      requesterUserId: companyIds[companyIdx],
      targetUserId: vendorIds[vendorIdx],
      projectRoleId: null,
      vendorEquipmentId: vendorEqList.length > 0 ? vendorEqList[p % vendorEqList.length] : null,
      status,
      rateOffered: randomRate().min,
      message: `We need equipment/services rental for this production.`,
      respondedAt: ['accepted', 'declined', 'locked'].includes(status) ? pastDate(Math.floor(Math.random() * 30)) : null,
      lockedAt: status === 'locked' ? pastDate(Math.floor(Math.random() * 15)) : null,
      cancelRequestReason: status === 'cancel_requested' ? 'Budget constraints' : null,
      cancelRequestedAt: status === 'cancel_requested' ? pastDate(Math.floor(Math.random() * 5)) : null,
    });
    bookingMeta.push({ id: bookingId, projectId, requesterId: companyIds[companyIdx], targetId: vendorIds[vendorIdx], status });
    vendorBookingCount++;
  }

  for (const batch of chunk(bookingRecords, BATCH_SIZE)) {
    await prisma.bookingRequest.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${bookingRecords.length} bookings created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 11. Conversations & Messages (50,000+ messages)
  // ─────────────────────────────────────────
  console.log(`\nCreating conversations & messages (${NUM_MESSAGES_TARGET}+)...`);

  // Deduplicate conversation participants
  const convKeySet = new Set<string>();
  const conversationRecords: {
    id: string;
    projectId: string;
    participantA: string;
    participantB: string;
    lastMessageAt: Date;
  }[] = [];
  const convMeta: { convId: string; participantA: string; participantB: string }[] = [];

  // Create conversations from bookings
  for (const bk of bookingMeta) {
    const pA = bk.requesterId < bk.targetId ? bk.requesterId : bk.targetId;
    const pB = bk.requesterId < bk.targetId ? bk.targetId : bk.requesterId;
    const key = `${bk.projectId}:${pA}:${pB}`;
    if (convKeySet.has(key)) continue;
    convKeySet.add(key);

    const convId = randomUUID();
    conversationRecords.push({
      id: convId,
      projectId: bk.projectId,
      participantA: pA,
      participantB: pB,
      lastMessageAt: pastDate(Math.floor(Math.random() * 10)),
    });
    convMeta.push({ convId, participantA: pA, participantB: pB });

    // Limit conversations to keep messages around target
    // Average ~5 messages per conversation, so we need ~10000 conversations
    if (conversationRecords.length >= Math.ceil(NUM_MESSAGES_TARGET / 5)) break;
  }

  for (const batch of chunk(conversationRecords, BATCH_SIZE)) {
    await prisma.conversation.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${conversationRecords.length} conversations created in ${elapsed(t0)}`);

  // Generate messages
  console.log('  Generating messages...');
  const messageRecords: {
    conversationId: string;
    senderId: string;
    type: MessageType;
    content: string;
    isRead: boolean;
    createdAt: Date;
  }[] = [];

  for (let ci = 0; ci < convMeta.length; ci++) {
    const conv = convMeta[ci];
    const msgCount = Math.floor(Math.random() * 4) + 3; // 3-6 messages per conversation

    for (let m = 0; m < msgCount; m++) {
      const isFromA = m % 2 === 0;
      const daysAgo = msgCount - m;
      const msgDate = new Date();
      msgDate.setDate(msgDate.getDate() - daysAgo);
      msgDate.setHours(8 + m * 2, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);

      messageRecords.push({
        conversationId: conv.convId,
        senderId: isFromA ? conv.participantA : conv.participantB,
        type: MessageType.text,
        content: CHAT_MESSAGES[(ci + m) % CHAT_MESSAGES.length],
        isRead: m < msgCount - 1, // last message unread
        createdAt: msgDate,
      });
    }
  }

  for (const batch of chunk(messageRecords, BATCH_SIZE)) {
    await prisma.message.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${messageRecords.length} messages created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 12. Invoices (10,000+)
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_INVOICES_TARGET}+ invoices...`);
  const invoiceStatuses: InvoiceStatus[] = ['sent', 'paid', 'draft', 'sent', 'overdue'];

  const invoiceRecords: {
    id: string;
    projectId: string;
    issuerUserId: string;
    recipientUserId: string;
    invoiceNumber: string;
    amount: number;
    gstAmount: number;
    totalAmount: number;
    status: InvoiceStatus;
    dueDate: Date;
    paidAt: Date | null;
  }[] = [];

  // Use accepted/locked bookings for invoices
  const eligibleBookings = bookingMeta.filter(b => b.status === 'accepted' || b.status === 'locked');

  for (let i = 0; i < NUM_INVOICES_TARGET; i++) {
    const bk = eligibleBookings[i % eligibleBookings.length];
    const amount = (Math.floor(Math.random() * 50) + 10) * 100_00;
    const gstAmount = Math.round(amount * 0.18);
    const totalAmount = amount + gstAmount;
    const status = invoiceStatuses[i % invoiceStatuses.length];
    const invoiceId = randomUUID();

    invoiceRecords.push({
      id: invoiceId,
      projectId: bk.projectId,
      issuerUserId: bk.targetId,
      recipientUserId: bk.requesterId,
      invoiceNumber: `INV-${padNum(i + 1, 6)}`,
      amount,
      gstAmount,
      totalAmount,
      status,
      dueDate: futureDate(30 + (i % 60)),
      paidAt: status === 'paid' ? pastDate(Math.floor(Math.random() * 10)) : null,
    });
  }

  for (const batch of chunk(invoiceRecords, BATCH_SIZE)) {
    await prisma.invoice.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${invoiceRecords.length} invoices created in ${elapsed(t0)}`);

  // Invoice Line Items (1-3 per invoice)
  console.log('  Creating invoice line items...');
  const lineItemRecords: {
    invoiceId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[] = [];

  for (const inv of invoiceRecords) {
    const lineCount = Math.floor(Math.random() * 3) + 1;
    for (let l = 0; l < lineCount; l++) {
      const qty = Math.floor(Math.random() * 5) + 1;
      const unitPrice = Math.floor(inv.amount / lineCount / qty);
      lineItemRecords.push({
        invoiceId: inv.id,
        description: LINE_ITEM_DESCRIPTIONS[(lineItemRecords.length + l) % LINE_ITEM_DESCRIPTIONS.length],
        quantity: qty,
        unitPrice,
        amount: unitPrice * qty,
      });
    }
  }

  for (const batch of chunk(lineItemRecords, BATCH_SIZE)) {
    await prisma.invoiceLineItem.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${lineItemRecords.length} line items created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 13. Reviews (5,000+)
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_REVIEWS_TARGET}+ reviews...`);
  const reviewRecords: {
    bookingId: string;
    reviewerUserId: string;
    revieweeUserId: string;
    rating: number;
    text: string;
  }[] = [];

  // Use accepted/locked bookings, one review per booking (reviewer = requester reviewing target)
  const reviewBookings = bookingMeta.filter(b => b.status === 'accepted' || b.status === 'locked');
  const usedReviewKeys = new Set<string>();

  for (let i = 0; i < NUM_REVIEWS_TARGET && i < reviewBookings.length; i++) {
    const bk = reviewBookings[i];
    const key = `${bk.id}:${bk.requesterId}`;
    if (usedReviewKeys.has(key)) continue;
    usedReviewKeys.add(key);

    reviewRecords.push({
      bookingId: bk.id,
      reviewerUserId: bk.requesterId,
      revieweeUserId: bk.targetId,
      rating: Math.floor(Math.random() * 3) + 3, // 3-5 rating
      text: REVIEW_TEXTS[i % REVIEW_TEXTS.length],
    });
  }

  // If we still need more reviews, add reverse reviews (target reviewing requester)
  if (reviewRecords.length < NUM_REVIEWS_TARGET) {
    for (let i = 0; i < reviewBookings.length && reviewRecords.length < NUM_REVIEWS_TARGET; i++) {
      const bk = reviewBookings[i];
      const key = `${bk.id}:${bk.targetId}`;
      if (usedReviewKeys.has(key)) continue;
      usedReviewKeys.add(key);

      reviewRecords.push({
        bookingId: bk.id,
        reviewerUserId: bk.targetId,
        revieweeUserId: bk.requesterId,
        rating: Math.floor(Math.random() * 3) + 3,
        text: REVIEW_TEXTS[i % REVIEW_TEXTS.length],
      });
    }
  }

  for (const batch of chunk(reviewRecords, BATCH_SIZE)) {
    await prisma.review.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${reviewRecords.length} reviews created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 14. Notifications (10,000+)
  // ─────────────────────────────────────────
  console.log(`\nCreating ${NUM_NOTIFICATIONS_TARGET}+ notifications...`);
  const notificationRecords: {
    userId: string;
    type: string;
    title: string;
    body: string;
    readAt: Date | null;
    createdAt: Date;
  }[] = [];

  // Spread across all user types
  // ~4000 for freelancers, ~4000 for companies, ~2000 for vendors
  const allUserIds = [...freelancerIds, ...companyIds, ...vendorIds];
  for (let i = 0; i < NUM_NOTIFICATIONS_TARGET; i++) {
    const userId = allUserIds[i % allUserIds.length];
    const notif = NOTIFICATION_TYPES[i % NOTIFICATION_TYPES.length];
    const daysAgo = Math.floor(Math.random() * 30);
    const createdAt = pastDate(daysAgo);
    notificationRecords.push({
      userId,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      readAt: Math.random() > 0.3 ? createdAt : null, // 70% read
      createdAt,
    });
  }

  for (const batch of chunk(notificationRecords, BATCH_SIZE)) {
    await prisma.notification.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${notificationRecords.length} notifications created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // 15. Sub-Users (2 per first 50 companies)
  // ─────────────────────────────────────────
  console.log('\nCreating sub-users...');
  const subUserRecords: {
    id: string;
    email: string;
    phone: string;
    passwordHash: string;
    role: UserRole;
    isVerified: boolean;
    isActive: boolean;
    mainUserId: string;
  }[] = [];
  const subUserAssignments: {
    accountUserId: string;
    subUserId: string;
    projectId: string;
  }[] = [];

  for (let c = 0; c < 50; c++) {
    for (let s = 1; s <= 2; s++) {
      const subId = randomUUID();
      subUserRecords.push({
        id: subId,
        email: `company${padNum(c + 1)}-sub${s}@claapo.test`,
        phone: uniquePhone(30000 + c * 2 + s),
        passwordHash,
        role: UserRole.company,
        isVerified: true,
        isActive: true,
        mainUserId: companyIds[c],
      });

      // Assign first project of this company
      const companyProjectIdx = c; // project index same as company index (mod)
      if (companyProjectIdx < projectIds.length) {
        subUserAssignments.push({
          accountUserId: companyIds[c],
          subUserId: subId,
          projectId: projectIds[companyProjectIdx],
        });
      }
    }
  }

  for (const batch of chunk(subUserRecords, BATCH_SIZE)) {
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
  }
  for (const batch of chunk(subUserAssignments, BATCH_SIZE)) {
    await prisma.subUserProjectAssignment.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`  ${subUserRecords.length} sub-users + ${subUserAssignments.length} assignments created in ${elapsed(t0)}`);

  // ─────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────
  const totalUsers = NUM_FREELANCERS + NUM_COMPANIES + NUM_VENDORS + subUserRecords.length;
  const totalRecords = totalUsers
    + individualProfiles.length
    + companyProfiles.length
    + vendorProfiles.length
    + equipmentRecords.length
    + slotData.length
    + projectRecords.length
    + projectRoleRecords.length
    + bookingRecords.length
    + conversationRecords.length
    + messageRecords.length
    + invoiceRecords.length
    + lineItemRecords.length
    + reviewRecords.length
    + notificationRecords.length
    + subUserAssignments.length;

  console.log('\n' + '='.repeat(70));
  console.log('  SEED COMPLETE — MASSIVE SCALE');
  console.log('='.repeat(70));
  console.log(`\n  Total time: ${elapsed(t0)}`);
  console.log(`  Total records: ~${totalRecords.toLocaleString()}`);
  console.log(`\n  Password for ALL accounts: ${DEFAULT_PASSWORD}\n`);

  console.log('  +-------------------------------------------------------------+');
  console.log('  |  FREELANCERS (2,000 accounts)                               |');
  console.log('  |  Email: freelancer0001@claapo.test -> freelancer2000@...     |');
  console.log('  |  Example: freelancer0001@claapo.test / Test@1234             |');
  console.log('  +-------------------------------------------------------------+');
  console.log('  |  COMPANIES (1,000 accounts)                                 |');
  console.log('  |  Email: company0001@claapo.test -> company1000@...           |');
  console.log('  |  Example: company0001@claapo.test / Test@1234                |');
  console.log('  |  Sub-users: company0001-sub1@claapo.test (first 50 cos)      |');
  console.log('  +-------------------------------------------------------------+');
  console.log('  |  VENDORS (500 accounts)                                     |');
  console.log('  |  Email: vendor0001@claapo.test -> vendor0500@...             |');
  console.log('  |  Example: vendor0001@claapo.test / Test@1234                 |');
  console.log('  +-------------------------------------------------------------+');

  console.log('\n  DATA CREATED:');
  console.log(`    - ${NUM_FREELANCERS.toLocaleString()} Freelancers with profiles, skills, rates`);
  console.log(`    - ${NUM_COMPANIES.toLocaleString()} Companies with profiles, GST, addresses`);
  console.log(`    - ${NUM_VENDORS.toLocaleString()} Vendors with profiles`);
  console.log(`    - ${equipmentRecords.length.toLocaleString()} Equipment items`);
  console.log(`    - ${slotData.length.toLocaleString()} Availability slots`);
  console.log(`    - ${projectRecords.length.toLocaleString()} Projects with ${projectRoleRecords.length.toLocaleString()} roles`);
  console.log(`    - ${bookingRecords.length.toLocaleString()} Bookings across all statuses`);
  console.log(`    - ${conversationRecords.length.toLocaleString()} Conversations with ${messageRecords.length.toLocaleString()} messages`);
  console.log(`    - ${invoiceRecords.length.toLocaleString()} Invoices with ${lineItemRecords.length.toLocaleString()} line items`);
  console.log(`    - ${reviewRecords.length.toLocaleString()} Reviews`);
  console.log(`    - ${notificationRecords.length.toLocaleString()} Notifications`);
  console.log(`    - ${subUserRecords.length} Sub-users with ${subUserAssignments.length} project assignments`);
  console.log('');
}

main()
  .then(() => {
    console.log('Done!');
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error('Seed failed:', e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
