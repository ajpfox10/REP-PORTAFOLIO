'use strict';

const {
  Router,
  body,
  db,
  R,
  validate,
  logMedicalError,
  encryptFields,
  ANAMNESIS_FIELDS,
  ensureMedicalRecordInScope,
} = require('./medical-records.sections.common');

const router = Router();

router.post('/:id/anamnesis',
  body('currentIllnessHistory').notEmpty().isString().isLength({ max: 8000 }),
  body('illnessDuration').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('illnessOnset').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('otherSigns').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('vaccinationHistory').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('dewormingHistory').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('previousIllnesses').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('previousSurgeries').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('currentMedications').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('feedingBrand').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('recentTravel').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('ownerObservations').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('vomiting').optional({ nullable: true }).isBoolean().toBoolean(),
  body('coughing').optional({ nullable: true }).isBoolean().toBoolean(),
  body('sneezing').optional({ nullable: true }).isBoolean().toBoolean(),
  body('pruritus').optional({ nullable: true }).isBoolean().toBoolean(),
  body('locomotionIssues').optional({ nullable: true }).isBoolean().toBoolean(),
  body('contactWithAnimals').optional({ nullable: true }).isBoolean().toBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const scopedRecord = await ensureMedicalRecordInScope(req, req.params.id);
      if (!scopedRecord) return R.notFound(res, 'Historia clinica no encontrada');

      const {
        currentIllnessHistory, illnessDuration, illnessOnset,
        appetite, thirst, urination, defecation, vomiting, coughing,
        sneezing, pruritus, locomotionIssues, otherSigns,
        vaccinationHistory, dewormingHistory, previousIllnesses,
        previousSurgeries, currentMedications, feedingType, feedingBrand,
        environment, contactWithAnimals, recentTravel, ownerObservations,
      } = req.body;

      const encryptedAnamnesis = encryptFields({
        current_illness_history: currentIllnessHistory,
        illness_duration: illnessDuration || null,
        illness_onset: illnessOnset || null,
        other_signs: otherSigns || null,
        vaccination_history: vaccinationHistory || null,
        deworming_history: dewormingHistory || null,
        previous_illnesses: previousIllnesses || null,
        previous_surgeries: previousSurgeries || null,
        current_medications: currentMedications || null,
        feeding_brand: feedingBrand || null,
        recent_travel: recentTravel || null,
        owner_observations: ownerObservations || null,
      }, ANAMNESIS_FIELDS);

      await db.query(
        `INSERT INTO anamnesis
           (medical_record_id, current_illness_history, illness_duration, illness_onset,
            appetite, thirst, urination, defecation, vomiting, coughing,
            sneezing, pruritus, locomotion_issues, other_signs,
            vaccination_history, deworming_history, previous_illnesses,
            previous_surgeries, current_medications, feeding_type, feeding_brand,
            environment, contact_with_animals, recent_travel, owner_observations)
         VALUES (:mid, :cih, :dur, :onset, :app, :thr, :uri, :def, :vom, :cou,
                 :sne, :pru, :loc, :oth, :vac, :dew, :prev, :surg, :meds,
                 :feed, :brand, :env, :contact, :travel, :obs)
         ON DUPLICATE KEY UPDATE
           current_illness_history = VALUES(current_illness_history),
           illness_duration = VALUES(illness_duration),
           illness_onset = VALUES(illness_onset),
           appetite = VALUES(appetite),
           thirst = VALUES(thirst),
           urination = VALUES(urination),
           defecation = VALUES(defecation),
           vomiting = VALUES(vomiting),
           coughing = VALUES(coughing),
           sneezing = VALUES(sneezing),
           pruritus = VALUES(pruritus),
           locomotion_issues = VALUES(locomotion_issues),
           other_signs = VALUES(other_signs),
           vaccination_history = VALUES(vaccination_history),
           deworming_history = VALUES(deworming_history),
           previous_illnesses = VALUES(previous_illnesses),
           previous_surgeries = VALUES(previous_surgeries),
           current_medications = VALUES(current_medications),
           feeding_type = VALUES(feeding_type),
           feeding_brand = VALUES(feeding_brand),
           environment = VALUES(environment),
           contact_with_animals = VALUES(contact_with_animals),
           recent_travel = VALUES(recent_travel),
           owner_observations = VALUES(owner_observations)`,
        {
          mid: req.params.id,
          cih: encryptedAnamnesis.current_illness_history,
          dur: encryptedAnamnesis.illness_duration,
          onset: encryptedAnamnesis.illness_onset,
          app: appetite || null,
          thr: thirst || null,
          uri: urination || null,
          def: defecation || null,
          vom: vomiting || 0,
          cou: coughing || 0,
          sne: sneezing || 0,
          pru: pruritus || 0,
          loc: locomotionIssues || 0,
          oth: encryptedAnamnesis.other_signs,
          vac: encryptedAnamnesis.vaccination_history,
          dew: encryptedAnamnesis.deworming_history,
          prev: encryptedAnamnesis.previous_illnesses,
          surg: encryptedAnamnesis.previous_surgeries,
          meds: encryptedAnamnesis.current_medications,
          feed: feedingType || null,
          brand: encryptedAnamnesis.feeding_brand,
          env: environment || null,
          contact: contactWithAnimals || 0,
          travel: encryptedAnamnesis.recent_travel,
          obs: encryptedAnamnesis.owner_observations,
        }
      );
      return R.created(res);
    } catch (e) {
      logMedicalError('records.POST /medical-records/:id/anamnesis', e, { recordId: req.params.id, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
