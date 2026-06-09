require('dotenv').config({ path: 'C:\\Users\\HP\\backend\\.env' });
const mongoose = require('mongoose');
const University = require('C:\\Users\\HP\\backend\\src\\models\\University.js');

const universities = [
  { name: 'University of Ghana', location: 'Legon, Accra', region: 'Greater Accra', description: 'The premier university in Ghana.' },
  { name: 'KNUST', location: 'Kumasi', region: 'Ashanti', description: 'Kwame Nkrumah University of Science and Technology.' },
  { name: 'University of Cape Coast', location: 'Cape Coast', region: 'Central', description: 'UCC.' },
  { name: 'University for Development Studies', location: 'Tamale', region: 'Northern', description: 'UDS.' },
  { name: 'University of Education, Winneba', location: 'Winneba', region: 'Central', description: 'UEW.' },
  { name: 'GIMPA', location: 'Greenhill, Accra', region: 'Greater Accra', description: 'Ghana Institute of Management and Public Administration.' },
  { name: 'Ashesi University', location: 'Berekuso', region: 'Eastern', description: 'Ashesi.' },
  { name: 'Academic City University', location: 'Haatso, Accra', region: 'Greater Accra', description: 'Academic City.' },
  { name: 'Central University', location: 'Miotso', region: 'Greater Accra', description: 'Central University.' },
  { name: 'Valley View University', location: 'Oyibi', region: 'Greater Accra', description: 'VVU.' },
  { name: 'Wisconsin International University College', location: 'North Legon, Accra', region: 'Greater Accra', description: 'Wisconsin.' },
  { name: 'Lancaster University Ghana', location: 'Accra', region: 'Greater Accra', description: 'Lancaster.' },
  { name: 'Methodist University Ghana', location: 'Dansoman, Accra', region: 'Greater Accra', description: 'MUG.' },
  { name: 'Pentecost University', location: 'Sowutuom, Accra', region: 'Greater Accra', description: 'PU.' },
  { name: 'Regent University College', location: 'McCarthy Hill, Accra', region: 'Greater Accra', description: 'Regent.' },
  { name: 'Ghana Christian University College', location: 'Amrahia', region: 'Greater Accra', description: 'Ghana Christian UC.' },
  { name: 'BlueCrest University College', location: 'Kokomlemle, Accra', region: 'Greater Accra', description: 'BlueCrest.' },
  { name: 'Ghana Communication Technology University', location: 'Tesano, Accra', region: 'Greater Accra', description: 'GCTU.' },
  { name: 'Takoradi Technical University', location: 'Takoradi', region: 'Western', description: 'TTU.' },
  { name: 'Kumasi Technical University', location: 'Kumasi', region: 'Ashanti', description: 'KsTU.' },
  { name: 'Accra Technical University', location: 'Accra', region: 'Greater Accra', description: 'ATU.' },
  { name: 'Ho Technical University', location: 'Ho', region: 'Volta', description: 'HTU.' },
  { name: 'Koforidua Technical University', location: 'Koforidua', region: 'Eastern', description: 'KTU.' },
  { name: 'Sunyani Technical University', location: 'Sunyani', region: 'Bono', description: 'STU.' },
  { name: 'Tamale Technical University', location: 'Tamale', region: 'Northern', description: 'TaTU.' },
  { name: 'Bolgatanga Technical University', location: 'Bolgatanga', region: 'Upper East', description: 'BTU.' },
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
