'use strict';
const fs = require('fs');
const targets = require('./outreach-targets.json');

const skipDomains = [
  'ncbi','wikipedia','webmd','mayoclinic','harvard','who.int','cdc.gov','nih.gov',
  'forbes.com','nytimes.com','linkedin.com','reddit.com','facebook.com','youtube.com',
  'springer','sciencedirect','frontiersin','tandfonline','wiley.com','academic.oup',
  'fda.gov','bmj.com','mckinsey.com','ibm.com','salesforce.com','cnn.com','pbs.org',
  'medicalnewstoday.com','alz.org','aan.com','prevention.com','aspeninstitute.org',
  'serpzilla.com','linkee.ai','prposting.com','linkio.com','zealousweb.com',
  'businessfirms.co','agilityportal.io','heliuswork.com','webnus.net','clockgogo.com',
  'checkify.com','gluu.biz','medium.com','tim.blog','cos.io','thefreelancersyear',
  'jams.pub','trocglobal.com','trainual.com','jbrainhealth.org','thebrainhealthmagazine',
  'mindcrowd.org','brainfacts.org','gbhi.org','brightfocus.org','templehealth.org',
  'nationalhealthcouncil.org','taylorandfrancis','onlinelibrary','link.springer',
  'support.springernature','pmc.ncbi','cbhd.org','philosophersmag','forum.effectiveal',
  'cbmm.bwh','sncs-prod.mayo','healthaffairs.org','healthopenresearch.org',
  'journals.kmanpub','medinform.jmir','journal.ahima','bcphr.org','ghspjournal',
  'icmje.org','amjmed.com','publications.aap','journals.lww','tbcr.amegroups',
  'nutrition.org','ods.od.nih','uchealth.org','heart.org','betterhealth.vic.gov',
  'health.harvard','nhs.uk','mayoclinichealthsystem','coreprescribingsolutions',
  'insidetracker.com','prenuvo.com','precisionnutrition.com','ninr.nih.gov',
  'berelianimd.com','ce.mayo.edu','ihoptimize.org','wagnerintegrativehealth',
  'rize.io','skeptic.org.uk','edelman.com','nursing.ucsf','ijoc.org','pmc.ncbi',
  'nsuworks.nova','sagepub.com','ibm.com','rsmus.com','online.marquette','liftos.io',
  'activtrak.com','setup.us','sitekit.id','wcl.govt.nz','productiveblogging',
  'theproductivitypro.com','eugeneyan.com','jlvcollegecounseling','mercatus.org',
  'mh.bmj.com','jaad.org','aaaspolicyfellowships','scriptps','scripps.org',
  'stonybrookmedicine','womensbrainproject','podcast.virtualbrainhealthcenter',
  'brainhealthkitchen.substack','ebsco.com','pharmaceutical-journal','ebsco',
  'dsm-firmenich','biomedres.us','digital.teknoscienze','rave.ohiolink',
  'thehastingscenter','naturalgrocers.com','gotopia.tech','thenextweb.com',
  'blog.beeminder','quantifiedself.com','forum.quantifiedself','en.wikipedia',
  'workplacewellbeing.pro','prlink','angelamyerscreative','emedcert.com',
  'linkee.ai','conquer-2024','ezovion.com','doctiplus.net','thewellnesscorner',
  'completewellbeing.com','treatwiser.com','healthgrad.com','yourhealthmagazine',
  'markets.financial','frontlinegenomics','opencollective.com',
  'bodybiocorp','bodybio.com','brainmd.com','alleywatch.com',
  'omegaquant.com','mindlabpro.com',
];

const isSkipped = t => {
  try {
    const host = new URL(t.url).hostname.toLowerCase();
    return skipDomains.some(d => host.includes(d));
  } catch { return true; }
};

const isBadEmail = e => {
  if (!e) return true;
  const bad = ['your@email','foursigmatic','automattic.com','easternstandard','supplements@biomedcentral','supplements@springernature','supplements@springeropen'];
  return bad.some(b => e.includes(b));
};

const isRealContact = url => {
  if (!url) return false;
  const bad = ['.css','.js','constantcontact','plugins/contact','form-7'];
  return !bad.some(b => url.includes(b));
};

const filtered = targets.filter(t => {
  if (isSkipped(t)) return false;
  const goodEmail = t.email && !isBadEmail(t.email);
  const goodContact = isRealContact(t.contact_page);
  return goodEmail || goodContact;
});

// Deduplicate by hostname
const seen = new Set();
const deduped = filtered.filter(t => {
  try {
    const host = new URL(t.url).hostname.replace('www.','');
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  } catch { return false; }
});

// Score and sort
const score = t => {
  let s = 0;
  if (t.email && !isBadEmail(t.email)) s += 2;
  if (isRealContact(t.contact_page)) s += 1;
  // Bonus for explicitly nootropic/biohacking niches
  if (['nootropics','biohacking','cognitive enhancement'].includes(t.niche)) s += 1;
  return s;
};
deduped.sort((a,b) => score(b) - score(a));

const top = deduped.slice(0, 50);
console.log('Total actionable targets:', deduped.length);
console.log('Top 50 written to top-targets.json\n');
top.forEach((t,i) => {
  const e = t.email && !isBadEmail(t.email) ? t.email.split(';')[0].trim() : '';
  const c = isRealContact(t.contact_page) ? t.contact_page : '';
  console.log(`${i+1}. [${t.niche}] ${t.site_name}`);
  if (e) console.log(`   email: ${e}`);
  if (c) console.log(`   contact: ${c}`);
  console.log('');
});

fs.writeFileSync('./top-targets.json', JSON.stringify(top, null, 2));
