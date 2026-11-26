/*
 * Crew Pay Board Pro: the features reserved for the Pro edition.
 *
 * Every function here is a stub. Pro is not open yet. If you came here to build one of these,
 * read PRO.md first: pull requests that add them will be closed with a pointer to it.
 * Nothing in this file contacts any server or checks a licence.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrewPayPro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Where Pro is described and what it will cost. Change them here and nowhere else. */
  var PRO_URL = 'https://github.com/westidwell/crew-pay-board/blob/main/PRO.md';
  var PRO_PRICE = '$1/month';

  /** The Pro features, in the order PRO.md lists them. The page uses this list for its locked buttons. */
  var PRO_FEATURES = [
    {
      key: 'crewSignIn',
      name: 'Crew sign-in',
      line: 'Each crew member signs in on their own phone and sees only their own jobs and pay.'
    },
    {
      key: 'officeApproval',
      name: 'Office approval',
      line: 'The office checks and approves each week before pay is final, and approved weeks lock.'
    },
    {
      key: 'multiCrew',
      name: 'Many crews and customer rate cards',
      line: 'Run several crews from one place, with a separate rate card for each customer.'
    },
    {
      key: 'photoProof',
      name: 'Photo proof',
      line: 'Attach photos to each job as proof the work was done.'
    },
    {
      key: 'payrollExport',
      name: 'Payroll export',
      line: 'Send approved weeks to payroll apps in the import format each one expects.'
    },
    {
      key: 'payHistory',
      name: 'Pay history across years',
      line: 'Year-to-date and year-end totals per person, with every past week a tap away.'
    }
  ];

  function feature(key) {
    for (var i = 0; i < PRO_FEATURES.length; i++) if (PRO_FEATURES[i].key === key) return PRO_FEATURES[i];
    throw new Error('Unknown Pro feature: ' + key);
  }

  /** "<Feature> is part of Pro ($1/month, not open yet): see PRO.md" */
  function proMessage(key) {
    return feature(key).name + ' is part of Pro (' + PRO_PRICE + ', not open yet): see PRO.md';
  }

  /** Thrown by every stub below. err.feature holds the feature key and err.url the PRO.md link. */
  class ProFeatureError extends Error {
    constructor(key) {
      super(proMessage(key));
      this.name = 'ProFeatureError';
      this.feature = key;
      this.url = PRO_URL;
    }
  }

  /**
   * Crew sign-in.
   * Gives each crew member their own sign-in on their own phone. They see only their own jobs and
   * running pay; the crew lead still sees everyone.
   */
  function crewSignIn(personId) {
    throw new ProFeatureError('crewSignIn');
  }

  /**
   * Office approval.
   * The office reviews a pay week, asks the crew lead about anything odd, and approves it. Pay is
   * final only after approval, and an approved week can no longer be edited.
   */
  function approveWeek(weekStart, approverName) {
    throw new ProFeatureError('officeApproval');
  }

  /**
   * Many crews.
   * Runs several crews from one place, each with its own people and pay weeks, with a roll-up of
   * what every crew earned.
   */
  function addCrew(crewName) {
    throw new ProFeatureError('multiCrew');
  }

  /**
   * Customer rate cards.
   * Keeps a separate rate card for each customer, so the same task can pay differently depending
   * on whose job it is. Part of "Many crews and customer rate cards".
   */
  function useCustomerRateCard(customerName) {
    throw new ProFeatureError('multiCrew');
  }

  /**
   * Photo proof.
   * Attaches photos to a job (posts set, panels hung, gate latched) so pay and back-charge
   * questions can be settled by looking.
   */
  function attachPhoto(jobId, photoFile) {
    throw new ProFeatureError('photoProof');
  }

  /**
   * Payroll export.
   * Sends an approved week to a payroll app in the import format that app expects, instead of
   * retyping totals.
   */
  function exportToPayroll(weekStart, payrollApp) {
    throw new ProFeatureError('payrollExport');
  }

  /**
   * Pay history across years.
   * Year-to-date and year-end totals per person, search across every past job, and year-end
   * summaries for tax time.
   */
  function payHistory(personId, fromYear, toYear) {
    throw new ProFeatureError('payHistory');
  }

  return {
    PRO_URL: PRO_URL,
    PRO_PRICE: PRO_PRICE,
    PRO_FEATURES: PRO_FEATURES,
    ProFeatureError: ProFeatureError,
    proMessage: proMessage,
    feature: feature,
    crewSignIn: crewSignIn,
    approveWeek: approveWeek,
    addCrew: addCrew,
    useCustomerRateCard: useCustomerRateCard,
    attachPhoto: attachPhoto,
    exportToPayroll: exportToPayroll,
    payHistory: payHistory
  };
});
