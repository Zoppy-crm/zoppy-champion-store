import { Company, Store, Order, Customer } from '@ZoppyTech/models';
import { OrderStatusEnum, StoreTypeEnum, StringUtil } from '@ZoppyTech/utilities';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StoreDistributionHelper } from './process-winner-store';
import { OrderStoreDistributionHelper } from './order-process-winner-store';
import { TestUtils } from '@ZoppyTech/test-utils';
import { execSync } from 'node:child_process';

type CreateOrder = {
    companyId: string;
    storeId: string;
    customerId: string;
    total: number;
    status: OrderStatusEnum;
};

function createCompany(name?: string): Promise<Company> {
    return Company.create({
        id: StringUtil.generateUuid(),
        name: name ?? 'Test Company'
    });
}

function phoneRandom() {
    const ddd: string = Math.floor(31 + Math.random() * 69).toString();
    const primeiroDigito: number = 9;
    const restoNumero: string = Math.floor(10000000 + Math.random() * 90000000).toString();

    return `${ddd}${primeiroDigito}${restoNumero}`;
}

function createStore({ companyId, type }: { companyId: string; type?: StoreTypeEnum }): Promise<Store> {
    return Store.create({
        id: StringUtil.generateUuid(),
        companyId: companyId,
        type: type ?? StoreTypeEnum.E_COMMERCE
    });
}

function createCustomer({ companyId, name, storeId }: { name?: string; companyId: string; storeId?: string }): Promise<Customer> {
    return Customer.create({
        id: StringUtil.generateUuid(),
        name: name ?? 'Test Customer',
        phone: phoneRandom(),
        companyId,
        storeId
    });
}

function createOrder({ companyId, customerId, status, storeId, total }: CreateOrder): Promise<Order> {
    return Order.create({
        id: StringUtil.generateUuid(),
        companyId,
        storeId,
        customerId,
        total,
        status
    });
}

async function createMultipleOrdersWithSameStore({
    companyId,
    customerId,
    storeId,
    total
}: {
    storeId: string;
    companyId: string;
    customerId: string;
    total: number;
}) {
    for (let i: number; i < total; i++) {
        await Order.create({
            id: StringUtil.generateUuid(),
            companyId,
            storeId,
            customerId,
            total,
            status: OrderStatusEnum.COMPLETED
        });
    }
}

describe('StoreDistributionHelper', () => {
    let app: INestApplication;

    beforeAll(async () => {
        await TestUtils.setSequelize();
        const moduleRef: TestingModule = await Test.createTestingModule({
            controllers: [],
            imports: [],
            providers: []
        }).compile();
        app = moduleRef.createNestApplication();
        await app.init();
    });

    beforeEach(async () => {
        execSync('rm -fr database.sqlite');
        await TestUtils.setSequelize();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('Shoud be able to update a storeId with new Order', async () => {
        const company: Company = await createCompany();

        const store1: Store = await createStore({ companyId: company.id });
        const store2: Store = await createStore({ companyId: company.id });

        const customer: Customer = await createCustomer({ companyId: company.id, storeId: store1.id });

        await createOrder({
            companyId: company.id,
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store1.id,
            total: 100
        });

        await createOrder({
            companyId: company.id,
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store2.id,
            total: 50
        });

        const newOrder: Order = {
            companyId: company.id,
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store2.id,
            total: 200
        } as Order;

        await OrderStoreDistributionHelper.execute(newOrder, customer);

        const customerUpdated: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(customerUpdated.storeId).toBe(store2.id);
    });

    it('Shoud not be able to continue if order has not StoreId', async () => {
        const customer: Customer = {
            id: StringUtil.generateUuid(),
            phone: phoneRandom()
        } as Customer;

        const order: Order = {
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: StringUtil.generateUuid(),
            total: 100
        } as Order;

        const processOrder: any = jest.spyOn(OrderStoreDistributionHelper, 'processOrder');

        await OrderStoreDistributionHelper.execute(order, customer);

        expect(processOrder).not.toBeCalled();
    });

    it('Shoud not be able to continue if company is blocked', async () => {
        const company: Company = await createCompany();

        const store: Store = await createStore({ companyId: company.id });

        const customer: Customer = await createCustomer({
            companyId: company.id
        });

        const order: Order = {
            companyId: company.id,
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store.id,
            total: 100
        } as Order;

        jest.spyOn(StoreDistributionHelper, 'isCompanyBlocked').mockResolvedValue(true);
        const storeAll: any = jest.spyOn(Store, 'findAll');

        await OrderStoreDistributionHelper.execute(order, customer);

        expect(storeAll).not.toBeCalled();
    });

    it('Should be able to update a show-room store with a new order', async () => {
        const company: Company = await createCompany();

        const store1: Store = await createStore({ companyId: company.id });
        const store2: Store = await createStore({ companyId: company.id, type: StoreTypeEnum.SHOW_ROOM });

        const customer: Customer = await createCustomer({ companyId: company.id, storeId: store1.id });

        await createMultipleOrdersWithSameStore({
            companyId: company.id,
            customerId: customer.id,
            storeId: store1.id,
            total: 5
        });

        const neworder: Order = {
            companyId: company.id,
            customerId: customer.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store2.id,
            total: 3
        } as Order;

        await OrderStoreDistributionHelper.execute(neworder, customer);

        const updatedCustomer: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(updatedCustomer.storeId).toBe(store2.id);
    });

    afterAll(async () => {
        await app.close();
    });
});
