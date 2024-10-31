import { Company, Store, Order, Customer } from '@ZoppyTech/models';
import { ArrayUtil, OrderStatusEnum, StoreTypeEnum, StringUtil } from '@ZoppyTech/utilities';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StoreDistributionHelper } from './process-winner-store';
import { TestUtils } from '@ZoppyTech/test-utils';
import { execSync } from 'node:child_process';

type CreateOrder = {
    companyId: string;
    storeId: string;
    customerId: string;
    total: number;
    status: OrderStatusEnum;
};

function phoneRandom() {
    const ddd: string = Math.floor(31 + Math.random() * 69).toString();
    const primeiroDigito: number = 9;
    const restoNumero: string = Math.floor(10000000 + Math.random() * 90000000).toString();

    return `${ddd}${primeiroDigito}${restoNumero}`;
}

function createCompany(name?: string): Promise<Company> {
    return Company.create({
        id: StringUtil.generateUuid(),
        name: name ?? 'Test Company'
    });
}

function createStore({ companyId, type }: { companyId: string; type?: StoreTypeEnum }): Promise<Store> {
    return Store.create({
        id: StringUtil.generateUuid(),
        companyId: companyId,
        type
    });
}

function createCustomer({ companyId, name, phone }: { name?: string; companyId: string; phone?: string }): Promise<Customer> {
    return Customer.create({
        id: StringUtil.generateUuid(),
        phone: phone ?? phoneRandom(),
        name: name ?? 'Test Customer',
        companyId
    });
}

function createOrder({ companyId, customerId, status, storeId, total }: CreateOrder): Promise<Order> {
    return Order.create({
        id: StringUtil.generateUuid(),
        companyId: companyId,
        storeId: storeId,
        customerId: customerId,
        total: total,
        status: status
    });
}

describe('StoreDistributionHelper', () => {
    let app: INestApplication;

    beforeAll(async () => {
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

    it('should process all companies', async () => {
        const mockCompanies: any = [{ id: '1', name: 'Test Company' }];
        jest.spyOn(Company, 'findAll').mockResolvedValue(mockCompanies);

        const processCompanySpy: any = jest.spyOn(StoreDistributionHelper, 'processCompany');
        await StoreDistributionHelper.execute();

        expect(processCompanySpy).toHaveBeenCalledTimes(mockCompanies.length);
    });

    it('should not process if company is blocked', async () => {
        const mockCompany: { id: string; name: string } = { id: '1', name: 'Test Company' };
        jest.spyOn(StoreDistributionHelper, 'isCompanyBlocked').mockResolvedValue(true);

        jest.spyOn(Customer, 'update').mockResolvedValue([0] as any);

        await StoreDistributionHelper.processCompany(mockCompany as any);

        expect(Customer.update).not.toHaveBeenCalled();
    });

    it('should be able to execute completely flux', async () => {
        const company: Company = await createCompany();

        const stor1: Store = await createStore({ companyId: company.id });

        await createStore({ companyId: company.id });

        const customer: Customer = await createCustomer({ companyId: company.id });

        await createOrder({
            companyId: company.id,
            storeId: stor1.id,
            customerId: customer.id,
            total: 100,
            status: OrderStatusEnum.COMPLETED
        });

        await createOrder({
            companyId: company.id,
            storeId: stor1.id,
            customerId: customer.id,
            total: 200,
            status: OrderStatusEnum.COMPLETED
        });

        await StoreDistributionHelper.execute();

        const customerUpdated: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(customerUpdated.storeId).toBe(stor1.id);
    });

    it('Should set the champion store based on total orders', async () => {
        const company: Company = await createCompany();
        const stor1: Store = await createStore({ companyId: company.id });
        const stor2: Store = await createStore({ companyId: company.id });

        const customer: Customer = await createCustomer({ companyId: company.id });

        await createOrder({
            companyId: company.id,
            storeId: stor1.id,
            customerId: customer.id,
            total: 100,
            status: OrderStatusEnum.COMPLETED
        });

        await createOrder({
            companyId: company.id,
            storeId: stor2.id,
            customerId: customer.id,
            total: 200,
            status: OrderStatusEnum.COMPLETED
        });

        await createOrder({
            companyId: company.id,
            storeId: stor2.id,
            customerId: customer.id,
            total: 550,
            status: OrderStatusEnum.COMPLETED
        });

        await StoreDistributionHelper.execute();

        const customerUpdated: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(customerUpdated.storeId).toBe(stor2.id);
    });

    it('should not update store if no completed orders', async () => {
        const company: Company = await createCompany();
        const store1: Store = await createStore({ companyId: company.id });

        const customer: Customer = await createCustomer({ companyId: company.id });

        await createOrder({
            companyId: company.id,
            storeId: store1.id,
            customerId: customer.id,
            total: 100,
            status: OrderStatusEnum.PROCESSING
        });

        await StoreDistributionHelper.execute();

        const customerUpdated: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(customerUpdated.storeId).toBeNull();
    });

    it('should process customers in chunks', async () => {
        const CHUNK_SIZE: number = 500;
        StoreDistributionHelper['CHUNK_SIZE'] = CHUNK_SIZE;
        const CUSTOMERS_SIZE: number = 1000;

        const company: Company = await createCompany();
        const store1: Store = await createStore({ companyId: company.id });

        const customers: Customer[] = [];
        for (let i: number = 0; i < CUSTOMERS_SIZE; i++) {
            customers.push({
                id: StringUtil.generateUuid(),
                name: `Customer ${i}`,
                phone: phoneRandom(),
                companyId: company.id
            } as unknown as Customer);
        }

        const chunksCustomer: Record<string, any>[][] = ArrayUtil.splitArrayIntoChunks(customers, CUSTOMERS_SIZE);

        for (const chunk of chunksCustomer) {
            await Customer.bulkCreate(chunk, {
                updateOnDuplicate: ['id']
            });
        }

        const orders: Order[] = [];
        for (const customer of customers) {
            orders.push({
                companyId: company.id,
                storeId: store1.id,
                customerId: customer.id,
                total: 100,
                status: OrderStatusEnum.COMPLETED
            } as Order);
        }

        const chunksOrder: Record<string, any>[][] = ArrayUtil.splitArrayIntoChunks(orders, CUSTOMERS_SIZE);

        for (const chunk of chunksOrder) {
            await Order.bulkCreate(chunk, {
                updateOnDuplicate: ['id']
            });
        }

        const customerUpdateSpy: any = jest.spyOn(Customer, 'bulkCreate');

        const numberOfJobsProcess: number = Math.ceil(CUSTOMERS_SIZE / CHUNK_SIZE);

        for (let i: number = 0; i < numberOfJobsProcess; i++) {
            await StoreDistributionHelper.execute();
        }

        expect(customerUpdateSpy).toHaveBeenCalledTimes(numberOfJobsProcess);
    });

    it('Shoud be possible to complete the flow with several stores', async () => {
        const company1: Company = await createCompany();

        const company2: Company = await createCompany();

        const stor1: Store = await createStore({ companyId: company1.id });

        const stor2: Store = await createStore({ companyId: company1.id });

        const stor3: Store = await createStore({ companyId: company2.id });

        const stor4: Store = await createStore({ companyId: company2.id });

        const customer1: Customer = await createCustomer({ companyId: company1.id });

        const customer2: Customer = await createCustomer({ companyId: company2.id });

        await createOrder({
            companyId: company1.id,
            storeId: stor1.id,
            customerId: customer1.id,
            total: 100,
            status: OrderStatusEnum.COMPLETED
        });
        await createOrder({
            companyId: company1.id,
            storeId: stor2.id,
            customerId: customer1.id,
            total: 200,
            status: OrderStatusEnum.COMPLETED
        });
        await createOrder({
            companyId: company2.id,
            storeId: stor3.id,
            customerId: customer2.id,
            total: 200,
            status: OrderStatusEnum.COMPLETED
        });
        await createOrder({
            companyId: company2.id,
            storeId: stor4.id,
            customerId: customer2.id,
            total: 300,
            status: OrderStatusEnum.COMPLETED
        });

        await StoreDistributionHelper.execute();

        const customer1Updated: Customer = await Customer.findOne({
            where: {
                id: customer1.id
            }
        });
        const customer2Updated: Customer = await Customer.findOne({
            where: {
                id: customer2.id
            }
        });

        expect(customer1Updated.storeId).toBe(stor2.id);
        expect(customer2Updated.storeId).toBe(stor4.id);
    });

    it('Should be able to set a winner store', async () => {
        const company: Company = await createCompany();

        const storeShowRoom: Store = await createStore({ companyId: company.id, type: StoreTypeEnum.SHOW_ROOM });

        const storeECommerce: Store = await createStore({ companyId: company.id, type: StoreTypeEnum.E_COMMERCE });

        const customer: Customer = await createCustomer({ companyId: company.id });

        await createOrder({
            companyId: company.id,
            storeId: storeShowRoom.id,
            customerId: customer.id,
            total: 100,
            status: OrderStatusEnum.COMPLETED
        });

        await createOrder({
            companyId: company.id,
            storeId: storeECommerce.id,
            customerId: customer.id,
            total: 500,
            status: OrderStatusEnum.COMPLETED
        });

        await createOrder({
            companyId: company.id,
            storeId: storeECommerce.id,
            customerId: customer.id,
            total: 200,
            status: OrderStatusEnum.COMPLETED
        });

        await StoreDistributionHelper.execute();

        const customerUpdated: Customer = await Customer.findOne({
            where: {
                id: customer.id
            }
        });

        expect(customerUpdated.storeId).toBe(storeShowRoom.id);
    });

    it('Should not process if order dont have storeId', async () => {
        const company: Company = await createCompany();
        const customer: Customer = await createCustomer({
            companyId: company.id
        });
        await Order.create({
            companyId: company.id,
            customerId: customer.id,
            total: 100
        });

        const bulkCreate: any = jest.spyOn(Customer, 'bulkCreate');

        await StoreDistributionHelper.execute();

        expect(bulkCreate).not.toBeCalled();
    });

    it('Should not process if order dont have customerId', async () => {
        const company: Company = await createCompany();
        const store: Store = await createStore({ companyId: company.id });
        await Order.create({
            companyId: company.id,
            storeId: store.id,
            total: 100
        });

        const bulkCreate: any = jest.spyOn(Customer, 'bulkCreate');

        await StoreDistributionHelper.execute();

        expect(bulkCreate).not.toBeCalled();
    });

    it('Should be able to set a winner store if have more than one customers with same phone', async () => {
        const company: Company = await createCompany();

        const store1: Store = await createStore({ companyId: company.id });
        const store2: Store = await createStore({ companyId: company.id });

        const phone: string = phoneRandom();

        const customer1: Customer = await createCustomer({ companyId: company.id, phone });

        const customer2: Customer = await createCustomer({ companyId: company.id, phone });

        await createOrder({
            companyId: company.id,
            customerId: customer1.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store1.id,
            total: 50
        });

        await createOrder({
            companyId: company.id,
            customerId: customer1.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store1.id,
            total: 100
        });

        await createOrder({
            companyId: company.id,
            customerId: customer2.id,
            status: OrderStatusEnum.COMPLETED,
            storeId: store2.id,
            total: 500
        });

        await StoreDistributionHelper.execute();

        const customer1Updated: Customer = await Customer.findOne({
            where: {
                id: customer1.id
            }
        });

        const customer2Updated: Customer = await Customer.findOne({
            where: {
                id: customer2.id
            }
        });

        expect(customer1Updated.storeId).toBe(store1.id);
        expect(customer2Updated.storeId).toBe(store1.id);
    });

    afterAll(async () => {
        await app.close();
    });
});
