import { describe, it, expect } from 'vitest';
import { normalizeEmail } from '../../src/modules/auth/identifier.js';
import { isDisposableEmailDomain } from '../../src/middleware/emailFilter.js';

describe('Email Sanitization and Disposable Filter', () => {
  describe('Email Normalization (+tag sub-address stripping)', () => {
    it('strips +tag aliases for gmail.com and googlemail.com', () => {
      expect(normalizeEmail('user.name+bot1@gmail.com')).toBe('username@gmail.com');
      expect(normalizeEmail('User.Name+promo123@googlemail.com')).toBe('username@gmail.com');
    });

    it('strips +tag aliases for outlook.com and hotmail.com', () => {
      expect(normalizeEmail('john.doe+tickets@outlook.com')).toBe('john.doe@outlook.com');
      expect(normalizeEmail('Jane.Doe+spam@hotmail.com')).toBe('jane.doe@hotmail.com');
    });

    it('strips -tag aliases for yahoo.com', () => {
      expect(normalizeEmail('user.name-tickets@yahoo.com')).toBe('user.name@yahoo.com');
      expect(normalizeEmail('user.name+tickets@yahoo.com')).toBe('user.name@yahoo.com');
    });

    it('leaves standard custom domain emails unmodified beyond lowercase/trim', () => {
      expect(normalizeEmail('  Organizer@Company.VN  ')).toBe('organizer@company.vn');
      expect(normalizeEmail('admin+tag@customdomain.io')).toBe('admin+tag@customdomain.io');
    });
  });

  describe('Disposable Domain Filtering', () => {
    it('detects common disposable email providers', () => {
      expect(isDisposableEmailDomain('tempmail.com')).toBe(true);
      expect(isDisposableEmailDomain('10minutemail.com')).toBe(true);
      expect(isDisposableEmailDomain('guerrillamail.com')).toBe(true);
      expect(isDisposableEmailDomain('mailinator.com')).toBe(true);
      expect(isDisposableEmailDomain('sharklasers.com')).toBe(true);
      expect(isDisposableEmailDomain('yopmail.com')).toBe(true);
    });

    it('allows legitimate email service domains', () => {
      expect(isDisposableEmailDomain('gmail.com')).toBe(false);
      expect(isDisposableEmailDomain('outlook.com')).toBe(false);
      expect(isDisposableEmailDomain('yahoo.com')).toBe(false);
      expect(isDisposableEmailDomain('hcmus.edu.vn')).toBe(false);
      expect(isDisposableEmailDomain('tixhub.fit')).toBe(false);
    });
  });
});
