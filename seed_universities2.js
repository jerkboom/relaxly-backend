require('dotenv').config({ path: 'C:\\Users\\HP\\backend\\.env' });
const mongoose = require('mongoose');
const University = require('C:\\Users\\HP\\backend\\src\\models\\University.js');

const universities = [
  { name: 'University of Health and Allied Sciences (UHAS)', location: 'Ho', region: 'Volta', description: 'UHAS.' },
  { name: 'Simon Diedong Dombo University of Business and Integrated Development Studies (SD-UBIDS)', location: 'Wa', region: 'Upper West', description: 'SD-UBIDS.' },
  { name: 'C.K. Tedam University of Technology and Applied Sciences (CKT-UTAS)', location: 'Navrongo', region: 'Upper East', description: 'CKT-UTAS.' },
  { name: 'University of Energy and Natural Resources (UENR)', location: 'Sunyani', region: 'Bono', description: 'UENR.' },
  { name: 'Ensign Global College', location: 'Kpong', region: 'Eastern', description: 'Ensign Global College.' },
  { name: 'Catholic University College of Ghana', location: 'Fiapre, Sunyani', region: 'Bono', description: 'CUCG.' },
  { name: 'Presbyterian University College', location: 'Abetifi', region: 'Eastern', description: 'PUCG.' },
  { name: 'Garden City University College', location: 'Kenyasi, Kumasi', region: 'Ashanti', description: 'GCUC.' },
  { name: 'All Nations University', location: 'Koforidua', region: 'Eastern', description: 'All Nations.' },
  { name: 'Webster University Ghana', location: 'East Legon, Accra', region: 'Greater Accra', description: 'Webster.' },
  { name: 'African University College of Communications', location: 'Adabraka, Accra', region: 'Greater Accra', description: 'AUCC.' },
  { name: 'Ghana Baptist University College', location: 'Kumasi', region: 'Ashanti', description: 'GBUC.' },
  { name: 'KAAF University College', location: 'Buduburam', region: 'Greater Accra', description: 'KAAF.' },
  { name: 'Zenith University College', location: 'LA, Accra', region: 'Greater Accra', description: 'Zenith.' },
  { name: 'Radford University College', location: 'East Legon, Accra', region: 'Greater Accra', description: 'Radford.' },
  { name: 'Knutsford University College', location: 'East Legon, Accra', region: 'Greater Accra', description: 'Knutsford.' },
  { name: 'Data Link Institute', location: 'Tema', region: 'Greater Accra', description: 'Data Link.' },
  { name: 'National Film and Television Institute (NAFTI)', location: 'Cantonments, Accra', region: 'Greater Accra', description: 'NAFTI.' },
];

async function seedUniversities() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    for (const uni of universities) {
      const exists = await University.findOne({ name: uni.name });
      if (!exists) {
        await University.create(uni);
        console.log('Added: ' + uni.name);
      } else {
        console.log('Exists: ' + uni.name);
      }
    }
    console.log('Seeding complete');
  } catch (err) {
    console.error('Error seeding universities', err);
  } finally {
    mongoose.connection.close();
  }
}

seedUniversities();