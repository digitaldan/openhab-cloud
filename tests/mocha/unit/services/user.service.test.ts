/*
 * Copyright (c) 2010-2026 Contributors to the openHAB project
 *
 * See the NOTICE file(s) distributed with this work for additional
 * information.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { Types } from 'mongoose';
import { UserService } from '../../../../src/services/user.service';
import { userCache, openhabCache } from '../../../../src/lib/lookup-caches';
import type { IUser } from '../../../../src/types/models';

describe('UserService cache invalidation', () => {
  const accountId = new Types.ObjectId();
  const owner = { _id: new Types.ObjectId(), username: 'owner@example.com', account: accountId };
  const member = { _id: new Types.ObjectId(), username: 'member@example.com', account: accountId };

  let userRepository: Record<string, sinon.SinonStub>;
  let service: UserService;

  const buildService = (): UserService => {
    userRepository = {
      findById: sinon.stub().resolves(owner as unknown as IUser),
      findByAccount: sinon.stub().resolves([owner, member] as unknown as IUser[]),
      deleteByAccount: sinon.stub().resolves(),
      setPassword: sinon.stub().resolves(true),
      checkPassword: sinon.stub().resolves(true),
    };

    return new UserService(
      userRepository as never,
      { findById: sinon.stub().resolves({ _id: accountId }), deleteById: sinon.stub().resolves() } as never,
      { findByAccount: sinon.stub().resolves(null), deleteByAccount: sinon.stub().resolves() } as never,
      {} as never,
      {} as never,
      {
        deleteItemsByOpenhab: sinon.stub().resolves(),
        deleteEventsByOpenhab: sinon.stub().resolves(),
        deleteDevicesByOwner: sinon.stub().resolves(),
        deleteNotificationsByUser: sinon.stub().resolves(),
        deleteOAuth2TokensByUser: sinon.stub().resolves(),
        deleteWebhooksByOpenhab: sinon.stub().resolves(),
      } as never,
      {} as never,
      { isComplexEnough: () => true, getComplexityError: () => '' } as never,
      { baseUrl: 'https://localhost', registrationEnabled: true },
      { error: sinon.stub(), warn: sinon.stub(), info: sinon.stub(), debug: sinon.stub() } as never
    );
  };

  beforeEach(() => {
    userCache.clear();
    openhabCache.clear();
    service = buildService();
  });

  describe('deleteAccount', () => {
    it('drops every user on the account, not just the one deleting it', async () => {
      userCache.set(owner._id.toString(), owner as unknown as Express.User);
      userCache.set(member._id.toString(), member as unknown as Express.User);

      const result = await service.deleteAccount(owner._id);

      expect(result.success).to.be.true;
      expect(userCache.get(owner._id.toString())).to.be.undefined;
      expect(userCache.get(member._id.toString())).to.be.undefined;
    });

    it('drops the account openHAB entry', async () => {
      openhabCache.set(accountId.toString(), { uuid: 'test-uuid' } as never);

      await service.deleteAccount(owner._id);

      expect(openhabCache.get(accountId.toString())).to.be.undefined;
    });

    it('reads the account members before deleting them', async () => {
      await service.deleteAccount(owner._id);

      expect(userRepository['findByAccount']!.calledBefore(userRepository['deleteByAccount']!)).to.be
        .true;
    });
  });

  describe('changePassword', () => {
    it('drops the cached user so the new hash is picked up', async () => {
      userCache.set(owner._id.toString(), owner as unknown as Express.User);

      await service.changePassword(owner._id, 'old-password', 'NewPassw0rd!');

      expect(userCache.get(owner._id.toString())).to.be.undefined;
    });

    it('leaves the cache alone when the old password is wrong', async () => {
      userRepository['checkPassword']!.resolves(false);
      userCache.set(owner._id.toString(), owner as unknown as Express.User);

      const result = await service.changePassword(owner._id, 'wrong', 'NewPassw0rd!');

      expect(result.success).to.be.false;
      expect(userCache.get(owner._id.toString())).to.not.be.undefined;
    });
  });
});
