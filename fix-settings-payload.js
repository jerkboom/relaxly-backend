const fs = require('fs');
const path = require('path');

const filePath = "C:\\Users\\HP\\Desktop\\admin-frontend\\src\\app\\(dashboard)\\settings\\page.tsx";

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const newCode = `  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 1. Build a clean roomTypeAdjustments object (numeric values only)
    const cleanAdjustments: Record<string, number> = {};
    Object.entries(form.roomTypeAdjustments).forEach(([key, value]) => {
      // Safety: Only include valid room type keys, ensuring no accidental nesting
      if (!['supportSettings', 'email', 'phone', 'whatsapp'].includes(key)) {
        cleanAdjustments[key] = Number(value) || 0;
      }
    });

    // 2. Construct the payload EXPLICITLY to match backend expectations
    const payload = {
      commissionPercent: form.commissionPercent,
      serviceFeePercent: form.serviceFeePercent,
      estimatedTaxRate: form.estimatedTaxRate,
      bookingExpirationMinutes: form.bookingExpirationMinutes,
      manualHostelApproval: form.manualHostelApproval,
      roomTypeAdjustments: cleanAdjustments,
      supportSettings: {
        email: form.supportEmail,
        phone: form.supportPhone,
        whatsapp: form.supportWhatsApp
      }
    };

    console.log('--- SETTINGS SAVE PAYLOAD ---');
    console.log(JSON.stringify(payload, null, 2));

    updateSettingsMutation.mutate(payload);
  };`;

// Use a regex that is insensitive to whitespace/newlines for the target part
const regex = /const handleSubmit = \(e: React\.FormEvent\) => \{[\s\S]*?updateSettingsMutation\.mutate\(payload\);[\s\S]*?\};/;

if (regex.test(content)) {
    content = content.replace(regex, newCode);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Successfully fixed admin settings page payload structure.');
} else {
    console.error('Could not find the target code block using regex.');
}
