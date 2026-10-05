const JGC_RELEASE_ID = "987";
const JGC_CACHE_PREFIX = "jgc-portal-v";
const JGC_CACHE_NAME = JGC_CACHE_PREFIX + JGC_RELEASE_ID;
const JGC_APP_SHELL = [
  "./estimating/assets/browser-BDGuCp7f.js",
  "./estimating/assets/drawing-pdf-DJqE6NAh.js",
  "./estimating/assets/es-QqZ58AZx.js",
  "./estimating/assets/index-BwtHcVsR.js",
  "./estimating/assets/index-ePRg3scN.css",
  "./estimating/assets/job-schedule-pdf-sMwgfrXn.js",
  "./estimating/assets/job-warranty-pdf-PXzKPlDo.js",
  "./estimating/assets/pdf-B7oAq72t.js",
  "./estimating/assets/proposal-pdf-DB_8kv70.js",
  "./estimating/assets/purchase-order-pdf-ePMmUDWL.js",
  "./estimating/assets/quote-backup-pdf-IndnaMR_.js",
  "./estimating/assets/rfi-pdf-eBTwe2yI.js",
  "./estimating/assets/site-specific-pdf-CR-a17l4.js",
  "./estimating/assets/src-CllXXvNm.js",
  "./estimating/assets/browser-Dsv9sCND.js",
  "./estimating/assets/pdf-BLd_KhDc.js",
  "./estimating/assets/src-BYRL0ybL.js",
  "./estimating/assets/drawing-pdf-CKU0isIr.js",
  "./estimating/assets/es-Bx7BgYl9.js",
  "./estimating/assets/index-CLkpMpRY.js",
  "./estimating/assets/index-Dzme6v5v.css",
  "./estimating/assets/job-schedule-pdf-Ds0LSEgg.js",
  "./estimating/assets/job-warranty-pdf-DwBhZlcW.js",
  "./estimating/assets/proposal-pdf-B4j8W3Y4.js",
  "./estimating/assets/purchase-order-pdf-CEZF5eE3.js",
  "./estimating/assets/quote-backup-pdf-DpsRekAg.js",
  "./estimating/assets/rfi-pdf-D6Nh5EqW.js",
  "./estimating/assets/site-specific-pdf-B4yzUH2p.js",
  "./employee-contacts.js?v=1",
  "./employee-contacts.css?v=1",
  "./jsa-workers.js?v=1",
  "./jsa-workers.css?v=1",
  "./jsa-worker-editor.js?v=1",
  "./estimating/assets/browser-CNT2ZpE-.js",
  "./estimating/assets/drawing-pdf-BzRA70rV.js",
  "./estimating/assets/es-CzdUut7b.js",
  "./estimating/assets/index-B_kXSi3w.js",
  "./estimating/assets/job-schedule-pdf-CMuDvpLM.js",
  "./estimating/assets/job-warranty-pdf-DrwOJSn7.js",
  "./estimating/assets/pdf-CmfyUeSv.js",
  "./estimating/assets/proposal-pdf-B5pSiJcV.js",
  "./estimating/assets/purchase-order-pdf-D5nTX5Yv.js",
  "./estimating/assets/quote-backup-pdf-dM2hxDHu.js",
  "./estimating/assets/rfi-pdf-C6raQ4Ov.js",
  "./estimating/assets/site-specific-pdf-DwznDMg2.js",
  "./estimating/assets/src-DztyyrnD.js",


  "./estimating/assets/index-hn0icavN.css",

  "./estimating/assets/browser-D_-WhaHI.js",
  "./estimating/assets/drawing-pdf-DqcLat8x.js",
  "./estimating/assets/es-0t63Je_J.js",
  "./estimating/assets/index-CHZUpkCl.js",
  "./estimating/assets/index-CTHgYHGS.css",
  "./estimating/assets/job-schedule-pdf-Dj0cIE-8.js",
  "./estimating/assets/job-warranty-pdf-Hf3JC8z8.js",
  "./estimating/assets/pdf-Ca78GVXp.js",
  "./estimating/assets/proposal-pdf-DgXjQ9sm.js",
  "./estimating/assets/purchase-order-pdf-DpLqvMQq.js",
  "./estimating/assets/quote-backup-pdf-D5i8VT5f.js",
  "./estimating/assets/rfi-pdf-DmoW_LxE.js",
  "./estimating/assets/src-qs7kYfeF.js",

  "./estimating/assets/browser-kmh2XprF.js",
  "./estimating/assets/drawing-pdf-q7HDQuJi.js",
  "./estimating/assets/es-DKucGtHG.js",
  "./estimating/assets/index-DLRBQgAl.js",
  "./estimating/assets/index-DMmhPBWp.css",
  "./estimating/assets/job-schedule-pdf-UBhoGfpc.js",
  "./estimating/assets/job-warranty-pdf-GS5tB-0E.js",
  "./estimating/assets/pdf-BPqLQAQs.js",
  "./estimating/assets/proposal-pdf-JmapA1LN.js",
  "./estimating/assets/purchase-order-pdf-CmMToNDh.js",
  "./estimating/assets/quote-backup-pdf-4cY0YFoL.js",
  "./estimating/assets/rfi-pdf-CcuvmGUQ.js",
  "./estimating/assets/src-Csk4h7RB.js",
  "./job-board-context.js?v=2",
  "./job-board-report-pdf.js?v=3",
  "./job-board.css?v=7",
  "./job-board.html",
  "./job-board.js?v=9",
  "./job-board-email.js?v=1",
  "./vendor/qrcode.min.js?v=1",

  "./estimating/assets/browser-BC_1XtLF.js",
  "./estimating/assets/drawing-pdf-CJP6DGhE.js",
  "./estimating/assets/es-CLXe1qLs.js",
  "./estimating/assets/index-DiY8QEYr.js",
  "./estimating/assets/index-DrtKZo1x.css",
  "./estimating/assets/job-schedule-pdf-BRJOy_zj.js",
  "./estimating/assets/job-warranty-pdf-DtP5FNPd.js",
  "./estimating/assets/pdf-B45_HK_S.js",
  "./estimating/assets/proposal-pdf-2Mh0Ey2v.js",
  "./estimating/assets/purchase-order-pdf-BHPMZPoB.js",
  "./estimating/assets/quote-backup-pdf-D3MmL9RE.js",
  "./estimating/assets/rfi-pdf-Dnbo-WNZ.js",
  "./estimating/assets/src-DnyWaVO1.js",

  "./estimating/assets/browser-BeC7Ocr3.js",
  "./estimating/assets/pdf-DdBefQfi.js",
  "./estimating/assets/src-FzKl7waM.js",

  "./estimating/assets/drawing-pdf-BaGnTlLT.js",
  "./estimating/assets/es-C9jZFJSj.js",
  "./estimating/assets/index-DzjbHjan.js",
  "./estimating/assets/index-ojojsNij.css",
  "./estimating/assets/job-schedule-pdf-B-Q8nji8.js",
  "./estimating/assets/job-warranty-pdf-BcvuGvhC.js",
  "./estimating/assets/proposal-pdf-Cs64dD_f.js",
  "./estimating/assets/purchase-order-pdf-CVJTbqCz.js",
  "./estimating/assets/quote-backup-pdf-BAsUraCK.js",
  "./estimating/assets/rfi-pdf-6_MZmMBG.js",

  "./estimating/assets/browser-B21TEwKc.js",
  "./estimating/assets/drawing-pdf-XZ25FA0C.js",
  "./estimating/assets/es-Cbo4QZyU.js",
  "./estimating/assets/index-CqfznHvv.js",
  "./estimating/assets/index-D-MINxel.css",
  "./estimating/assets/job-schedule-pdf-DDqtexod.js",
  "./estimating/assets/job-warranty-pdf--nj6SgH9.js",
  "./estimating/assets/pdf-OqyCRshx.js",
  "./estimating/assets/proposal-pdf-CG2VR_iC.js",
  "./estimating/assets/purchase-order-pdf-BHBIT0RS.js",
  "./estimating/assets/quote-backup-pdf-DCT2y5ox.js",
  "./estimating/assets/rfi-pdf-BxYuYKpy.js",
  "./estimating/assets/src-CDQn4zdi.js",

  "./estimating/assets/browser-BnhodEm3.js",
  "./estimating/assets/drawing-pdf-D_vI4bJ4.js",
  "./estimating/assets/es-DSjth96h.js",
  "./estimating/assets/index-BNrs5dyw.css",
  "./estimating/assets/index-Do1-LQdz.js",
  "./estimating/assets/job-schedule-pdf-8DKVzqvw.js",
  "./estimating/assets/job-warranty-pdf-B6bBLY4P.js",
  "./estimating/assets/pdf-CXQNLiQq.js",
  "./estimating/assets/proposal-pdf-BeLRN0g0.js",
  "./estimating/assets/purchase-order-pdf-CzXSNCUA.js",
  "./estimating/assets/quote-backup-pdf-CV7-cRrZ.js",
  "./estimating/assets/rfi-pdf-Cnv5_-88.js",
  "./estimating/assets/src-CksuTTf8.js",
  "./estimating/jgc-warranty-logo-v1.png",
  "./estimating/jgc-warranty-signature-v1.png",

  "./estimating/assets/browser-LS2wcorW.js",
  "./estimating/assets/drawing-pdf-BpRFZXnE.js",
  "./estimating/assets/es-k8XMPjbh.js",
  "./estimating/assets/index-Bd8MTc_s.js",
  "./estimating/assets/index-DmDM1g30.css",
  "./estimating/assets/job-accounting-workbook-nafjXhd6.js",
  "./estimating/assets/job-schedule-pdf-MBWnsmTJ.js",
  "./estimating/assets/pdf-CdZ1tD42.js",
  "./estimating/assets/proposal-pdf-CCZE_On9.js",
  "./estimating/assets/purchase-order-pdf-3k-FjiZ3.js",
  "./estimating/assets/quote-backup-pdf-5rV6vaIh.js",
  "./estimating/assets/rfi-pdf-Cjh8YZmB.js",
  "./estimating/assets/src-DTgNmKnu.js",

  "./estimating/assets/browser-8h07EnE_.js",
  "./estimating/assets/drawing-pdf-tqfPRo77.js",
  "./estimating/assets/es-DgnEK3ht.js",
  "./estimating/assets/index-BUa8-Lkb.css",
  "./estimating/assets/index-CDTGZJKI.js",
  "./estimating/assets/job-schedule-pdf-Dhfr86Em.js",
  "./estimating/assets/pdf-DOua7aJZ.js",
  "./estimating/assets/proposal-pdf-yMgr7igz.js",
  "./estimating/assets/purchase-order-pdf-DnfcyHjC.js",
  "./estimating/assets/quote-backup-pdf-CW7RSzhd.js",
  "./estimating/assets/rfi-pdf-CD08hJ4c.js",
  "./estimating/assets/src-x0E9kB06.js",

  "./estimating/assets/browser-X-Ys7nMR.js",
  "./estimating/assets/drawing-pdf-vVdZ29AQ.js",
  "./estimating/assets/es-CDrqfKMp.js",
  "./estimating/assets/index-B9CMetYC.css",
  "./estimating/assets/index-Dg6cCiXD.js",
  "./estimating/assets/job-accounting-workbook-BkoN60Yp.js",
  "./estimating/assets/job-schedule-pdf-DRymoEYJ.js",
  "./estimating/assets/pdf-SWexEcz0.js",
  "./estimating/assets/proposal-pdf-CFN6l9uk.js",
  "./estimating/assets/purchase-order-pdf-Dk-JW9XW.js",
  "./estimating/assets/quote-backup-pdf-DugR7zG5.js",
  "./estimating/assets/rfi-pdf-YhZG8vdw.js",
  "./estimating/assets/src-DSmAZrHz.js",

  "./estimating/assets/drawing-pdf-B8WjUo3R.js",
  "./estimating/assets/es-csrauDHE.js",
  "./estimating/assets/index-BoaUMQCK.css",
  "./estimating/assets/index-CXECgI8i.js",
  "./estimating/assets/job-schedule-pdf-D3fjZ-po.js",
  "./estimating/assets/proposal-pdf-Deob0Mdx.js",
  "./estimating/assets/purchase-order-pdf-qoBfDcvg.js",
  "./estimating/assets/quote-backup-pdf-LIsl3QiF.js",
  "./estimating/assets/rfi-pdf-C-YxuWTS.js",
  "./estimating/supplier-import/pdf.worker.min.mjs",

  "./estimating/assets/es-Dnoqu_OE.js",
  "./estimating/assets/index-e2LTwhtF.js",
  "./estimating/assets/job-schedule-pdf-TcpRJMOa.js",
  "./estimating/assets/pdf-CD8xQsXH.js",
  "./estimating/assets/proposal-pdf-BIwx-yJz.js",
  "./estimating/assets/purchase-order-pdf-CsX3sUFI.js",
  "./estimating/assets/quote-backup-pdf-X2Z03rp1.js",
  "./estimating/assets/rfi-pdf-DLg-H5si.js",
  "./estimating/assets/src-BGT8tv3S.js",


  "./estimating/assets/es-B-_tW_uf.js",
  "./estimating/assets/index-XuxLFE6R.css",
  "./estimating/assets/index-Y3HcAMXi.js",
  "./estimating/assets/job-schedule-pdf-IyTWluZ3.js",
  "./estimating/assets/pdf-DbPMgZ5_.js",
  "./estimating/assets/proposal-pdf-CmwPkQJR.js",
  "./estimating/assets/purchase-order-pdf-D8UgjZk5.js",
  "./estimating/assets/quote-backup-pdf-ONT-up3w.js",
  "./estimating/assets/rfi-pdf-Cifx7XfL.js",
  "./estimating/assets/src-zts1nDlw.js",


  "./estimating/assets/es-s0qjDCHj.js",
  "./estimating/assets/index-1GzNLAaV.js",
  "./estimating/assets/index-J5XM5evr.css",
  "./estimating/assets/job-schedule-pdf-BwnNy1y1.js",
  "./estimating/assets/pdf-DHNhJEma.js",
  "./estimating/assets/proposal-pdf-2mA88PrE.js",
  "./estimating/assets/purchase-order-pdf-C2mq9YbV.js",
  "./estimating/assets/quote-backup-pdf-B_aMvx3j.js",
  "./estimating/assets/rfi-pdf-IXG1emJT.js",
  "./estimating/assets/src-DrjgOEah.js",


  "./estimating/assets/es-DhZee8Qa.js",
  "./estimating/assets/index-DqkBOQ7c.js",
  "./estimating/assets/job-accounting-workbook-De6OwB-z.js",
  "./estimating/assets/job-schedule-pdf-DFoiuJvz.js",
  "./estimating/assets/pdf-DVINWBdC.js",
  "./estimating/assets/proposal-pdf-Duif5A_G.js",
  "./estimating/assets/purchase-order-pdf-DuqWp1nk.js",
  "./estimating/assets/quote-backup-pdf-Dhg-YcVF.js",
  "./estimating/assets/rfi-pdf-CEA8PmXq.js",
  "./estimating/assets/src-Bh5q37eY.js",


  "./estimating/assets/es-vwhdJSfj.js",
  "./estimating/assets/index-Csg9ewG-.js",
  "./estimating/assets/index-W82Liy8i.css",
  "./estimating/assets/job-schedule-pdf-Dz_iJMvK.js",
  "./estimating/assets/pdf-CESNfq0M.js",
  "./estimating/assets/proposal-pdf-DMrOdygp.js",
  "./estimating/assets/purchase-order-pdf-Do5OiJBH.js",
  "./estimating/assets/quote-backup-pdf-CyY4sQ5v.js",
  "./estimating/assets/rfi-pdf-DDv2rI2e.js",
  "./estimating/assets/src-4RIsVdPB.js",


  "./estimating/assets/es-DZY-2-jU.js",
  "./estimating/assets/index-3l6eQL9_.js",
  "./estimating/assets/index-CYGk9xQa.css",
  "./estimating/assets/job-schedule-pdf-Bvxa7zC_.js",
  "./estimating/assets/pdf-DVd5OlPt.js",
  "./estimating/assets/proposal-pdf-DPbn4iDA.js",
  "./estimating/assets/purchase-order-pdf-6kVBZL5R.js",
  "./estimating/assets/quote-backup-pdf-CoivxJj-.js",
  "./estimating/assets/rfi-pdf-Dwo6cafK.js",
  "./estimating/assets/src-D5-EeMLI.js",

  "./estimating/assets/es-BTBTrujD.js",
  "./estimating/assets/index-B855QHDV.js",
  "./estimating/assets/index-D1DkTked.css",
  "./estimating/assets/pdf-WiNIP2cn.js",
  "./estimating/assets/proposal-pdf-nwfQILP3.js",
  "./estimating/assets/purchase-order-pdf-DT111L-J.js",
  "./estimating/assets/quote-backup-pdf-LokB10p2.js",
  "./estimating/assets/rfi-pdf-BK1l_HCf.js",
  "./estimating/assets/src-CVFLKyTj.js",

  "./estimating/assets/es-C8Yby4sp.js",
  "./estimating/assets/index-Dzl-vG0t.js",
  "./estimating/assets/index-SdZmLkZ2.css",
  "./estimating/assets/pdf-CgrxCJi1.js",
  "./estimating/assets/proposal-pdf-AiBMlumd.js",
  "./estimating/assets/purchase-order-pdf-BjriVY7X.js",
  "./estimating/assets/quote-backup-pdf-XoP6Jd9R.js",
  "./estimating/assets/rfi-pdf-Cm51B5NW.js",
  "./estimating/assets/src-llX0fZ7h.js",

  "./estimating/assets/es-D-Hm0wlb.js",
  "./estimating/assets/index-DS_PR7VG.css",
  "./estimating/assets/index-BNPbbts2.js",
  "./estimating/assets/pdf-CrU6IeVv.js",
  "./estimating/assets/proposal-pdf-DXpEthxP.js",
  "./estimating/assets/purchase-order-pdf-BfgbrdqZ.js",
  "./estimating/assets/quote-backup-pdf-D-Rh1eVW.js",
  "./estimating/assets/rfi-pdf-DLaFmwhO.js",
  "./estimating/assets/src-CGGPjrmN.js",

  "./estimating/assets/es-CcnaDAsV.js",
  "./estimating/assets/index-hi8pe92o.css",
  "./estimating/assets/index-DpaV9Ir0.js",
  "./estimating/assets/pdf-6_U_usO2.js",
  "./estimating/assets/proposal-pdf-DrG_7RWq.js",
  "./estimating/assets/purchase-order-pdf-C_fEbIFh.js",
  "./estimating/assets/quote-backup-pdf-BhXMcfFU.js",
  "./estimating/assets/rfi-pdf-CXGbln9P.js",
  "./estimating/assets/src-9leXR-ul.js",

  "./estimating/assets/es-CwMTnbk1.js",
  "./estimating/assets/index-CGbVWhDE.css",
  "./estimating/assets/index-CfJ6xtgn.js",
  "./estimating/assets/pdf-BuUEoI8b.js",
  "./estimating/assets/proposal-pdf-dIgbsQb2.js",
  "./estimating/assets/purchase-order-pdf-BMW636fe.js",
  "./estimating/assets/quote-backup-pdf-BM_4BHVj.js",
  "./estimating/assets/rfi-pdf-wUXXxomU.js",
  "./estimating/assets/src-5fOhVfYx.js",

  "./estimating/assets/es-DFYwozkm.js",
  "./estimating/assets/index-CGH75QGC.css",
  "./estimating/assets/index-DOMqWve_.js",
  "./estimating/assets/pdf-OVY8fKSA.js",
  "./estimating/assets/proposal-pdf-CvSWB69l.js",
  "./estimating/assets/purchase-order-pdf-DgcpacxO.js",
  "./estimating/assets/quote-backup-pdf-Di-W6T0B.js",
  "./estimating/assets/rfi-pdf-DxB6NYgw.js",
  "./estimating/assets/src-D7lol2fj.js",


  "./estimating/assets/es-BUgcYoIr.js",
  "./estimating/assets/index-BQRO87sV.css",
  "./estimating/assets/index-QLpDk9US.js",
  "./estimating/assets/pdf-D5lRN4hG.js",
  "./estimating/assets/proposal-pdf-DGS2wZGw.js",
  "./estimating/assets/purchase-order-pdf-BKJGE9Bh.js",
  "./estimating/assets/quote-backup-pdf-BdwEEdT1.js",
  "./estimating/assets/rfi-pdf-CIcnTceq.js",
  "./estimating/assets/src-BTlYHgK2.js",


  "./estimating/assets/es-DWznRuRa.js",
  "./estimating/assets/index-CrliRKRC.js",
  "./estimating/assets/pdf--WNtqw-L.js",
  "./estimating/assets/proposal-pdf-BOOYm2Yc.js",
  "./estimating/assets/purchase-order-pdf-DRd_CRck.js",
  "./estimating/assets/quote-backup-pdf-DQKlnjLd.js",
  "./estimating/assets/src-DhPW4Q1-.js",

  "./estimating/assets/es-DmExkzIV.js",
  "./estimating/assets/index-CrbWfj7x.js",
  "./estimating/assets/index-DyNZzZp0.css",
  "./estimating/assets/pdf-BnUByzor.js",
  "./estimating/assets/proposal-pdf-BSCye_X9.js",
  "./estimating/assets/purchase-order-pdf-EZ76snpQ.js",
  "./estimating/assets/quote-backup-pdf-TDOzJT4S.js",
  "./estimating/assets/src-BXW6UqME.js",
  "./estimating/assets/es-C8aViGpx.js",
  "./estimating/assets/index-CgBfTd_3.css",
  "./estimating/assets/index-PNRgofq3.js",
  "./estimating/assets/pdf-BQMpGHvm.js",
  "./estimating/assets/proposal-pdf-CGLbW2Rx.js",
  "./estimating/assets/purchase-order-pdf-D4aL2sgP.js",
  "./estimating/assets/quote-backup-pdf-DeWTkxgw.js",
  "./estimating/assets/src-B7LL8xGF.js",
  "./estimating/assets/es-DrVQeutb.js",
  "./estimating/assets/index-DWgfwVn9.js",
  "./estimating/assets/pdf-CKNoeQjV.js",
  "./estimating/assets/proposal-pdf-CmV2uWR_.js",
  "./estimating/assets/purchase-order-pdf-DSmn9ifz.js",
  "./estimating/assets/quote-backup-pdf-enPxHxLh.js",
  "./estimating/assets/src-Cn46xtOj.js",
  "./estimating/assets/index-CTY_b3gH.css",
  "./estimating/assets/purchase-order-pdf-z1t3Kkps.js",
  "./estimating/assets/proposal-pdf-BVzzYNcs.js",
  "./estimating/assets/src-DNvPZxmu.js",
  "./estimating/assets/quote-backup-pdf-D55qHGKo.js",
  "./estimating/assets/es-BtVvu_68.js",
  "./estimating/assets/pdf-C0yFnrvT.js",
  "./estimating/assets/index-CvtVKh6u.js",
  "./portal-readability.css?v=2",
  "./safety-report-tools.js?v=1",
  "./safety-report-tools.css?v=1",
  "./employee-injury-report.js?v=2",
  "./accident-report.js?v=2",
  "./estimating/assets/index-D4hAxtua.css",
  "./estimating/assets/purchase-order-pdf-CI2_EU5K.js",
  "./estimating/assets/proposal-pdf-Brr-FvCs.js",
  "./estimating/assets/src-DhGrwfhv.js",
  "./estimating/assets/quote-backup-pdf-DtLdQCv7.js",
  "./estimating/assets/es-CvtuIKKC.js",
  "./estimating/assets/pdf-D9bS-0ZN.js",
  "./estimating/assets/index-C4Tbb8Og.js",
  "./estimating/assets/purchase-order-pdf-D0lAWaEl.js",
  "./estimating/assets/proposal-pdf-LqlHyA_4.js",
  "./estimating/assets/src-BvDdHE2q.js",
  "./estimating/assets/quote-backup-pdf-qq41XXQn.js",
  "./estimating/assets/es-Cx8fY1o5.js",
  "./estimating/assets/pdf-DOj6iGwq.js",
  "./estimating/assets/index-CVu8ukcK.js",
  "./estimating/assets/es-UWCyVCrj.js",
  "./estimating/assets/index-C0DqFHgi.js",
  "./estimating/assets/index-DiIIaSY2.css",
  "./estimating/assets/pdf-DMJIDDiU.js",
  "./estimating/assets/proposal-pdf-CGIaPkQM.js",
  "./estimating/assets/purchase-order-pdf-fmlRmmzM.js",
  "./estimating/assets/quote-backup-pdf-P_TI0kNk.js",
  "./estimating/assets/src-CCvL-qwe.js",
  "./job-list-sync.js?v=1",
  "./estimating/assets/es-DQm3uRGq.js",
  "./estimating/assets/index-BCQSZ9vp.js",
  "./estimating/assets/pdf-dyN0xtMN.js",
  "./estimating/assets/proposal-pdf-GIOoy7NT.js",
  "./estimating/assets/purchase-order-pdf-DJfAWR2r.js",
  "./estimating/assets/quote-backup-pdf-DULe0aeT.js",
  "./estimating/assets/src-CrmGe9oo.js",
  "./estimating/assets/es-Ww8d9T9p.js",
  "./estimating/assets/index-B3PIGspm.css",
  "./estimating/assets/index-BkLWidKZ.js",
  "./estimating/assets/pdf-DA6yCMzW.js",
  "./estimating/assets/proposal-pdf-DM1BqCd-.js",
  "./estimating/assets/purchase-order-pdf-Cbdvi86d.js",
  "./estimating/assets/quote-backup-pdf-C84pIFop.js",
  "./estimating/assets/src-BIoAvMy4.js",
  "./estimating/assets/index-U0-B9SFs.js",
  "./estimating/assets/purchase-order-pdf-CVeZBCwq.js",
  "./estimating/assets/proposal-pdf-3eUS4Jui.js",
  "./estimating/assets/src-sVKWu5Go.js",
  "./estimating/assets/quote-backup-pdf-CfJ5glxy.js",
  "./estimating/assets/es-88uQEMGC.js",
  "./estimating/assets/pdf-Dkb6uy9M.js",
  "./estimating/assets/index-BHB3l1lv.css",
  "./estimating/assets/index-BDQngpvU.js",
  "./estimating/assets/job-accounting-workbook-DbcdNSoj.js",
  "./estimating/assets/purchase-order-pdf-BxX7yB35.js",
  "./estimating/assets/proposal-pdf-FaIA_25Y.js",
  "./estimating/assets/src-DFdSn-OF.js",
  "./estimating/assets/quote-backup-pdf-BrX22bQ0.js",
  "./estimating/assets/es-BVbyVON7.js",
  "./estimating/assets/pdf-C8lwRfZW.js",
  "./estimating/assets/index-CQjj3S5B.css",
  "./estimating/assets/index-B7BxOcxZ.js",
  "./estimating/assets/purchase-order-pdf-DVFpA4mN.js",
  "./estimating/assets/proposal-pdf-rprOhtuG.js",
  "./estimating/assets/src-BJA7wijN.js",
  "./estimating/assets/quote-backup-pdf-B4yCyLyS.js",
  "./estimating/assets/es-DkCQGD65.js",
  "./estimating/assets/pdf-CnHMMJnT.js",
  "./estimating/assets/index-CvVwUZpF.css",
  "./estimating/assets/index-BKApgg_J.js",
  "./estimating/assets/job-accounting-workbook-CyqFFsL4.js",
  "./estimating/assets/purchase-order-pdf-vo4fM6in.js",
  "./estimating/assets/proposal-pdf-CKDd-qEV.js",
  "./estimating/assets/src-CEeShez1.js",
  "./estimating/assets/quote-backup-pdf-CYsbNHwn.js",
  "./estimating/assets/es-DqAOFkR6.js",
  "./estimating/assets/pdf-D_Tqvs4A.js",
  "./",
  "./index.html",
  "./acknowledge.html",
  "./equipment-inspection.html",
  "./vehicle-inspection.html",
  "./subcontractor.html",
  "./limited-access.html",
  "./limited-access.css?v=2",
  "./home.html",
  "./timesheet.html",
  "./inspections.html",
  "./daily-site-report.html",
  "./todays-inspections.html",
  "./previous-inspections.html",
  "./certificates-admin.html",
  "./certificates.html",
  "./vacation-request.html",
  "./schedule.html",
  "./tasks.html",
  "./tasks.html?embedded=1&admin=1",
  "./contacts.html",
  "./subcontractors-suppliers.html",
  "./policies-announcements.html",
  "./equipment-vehicles.html",
  "./field-calculator.html",
  "./jobs.html",
  "./work-orders.html",
  "./purchase-orders.html",
  "./purchase-orders-admin.html",
  "./accounting-admin.html",
  "./employee-access-admin.html",
  "./job-lists.html",
  "./job-lists-admin.html",
  "./diagnostics-admin.html",
  "./permits.html",
  "./confined-space-permit.html",
  "./excavation-permit.html",
  "./reports.html",
  "./accident-report.html",
  "./employee-injury-report.html",
  "./toolbox-talks.html",
  "./toolbox-report-actions.js?v=1",
  "./incident-report.html",
  "./admin.html",
  "./estimating/index.html",
  "./estimating/assets/es-WFU_p6Fu.js",
  "./estimating/assets/index-CsLtylNr.js",
  "./estimating/assets/index-DagjfWwG.css",
  "./estimating/assets/pdf-CzfozCzN.js",
  "./estimating/assets/proposal-pdf-CKnjpC9L.js",
  "./estimating/assets/purchase-order-pdf-D_xbe7zb.js",
  "./estimating/assets/quote-backup-pdf-R5WP34N5.js",
  "./estimating/assets/src-BH1aSMez.js",
  "./estimating/assets/es-CUDLzmUy.js",
  "./estimating/assets/index-Bz21tXJw.js",
  "./estimating/assets/pdf-D40UtVIv.js",
  "./estimating/assets/proposal-pdf-CRfHEdeT.js",
  "./estimating/assets/purchase-order-pdf-eV3EMHgo.js",
  "./estimating/assets/quote-backup-pdf-DTXqIFRt.js",
  "./estimating/assets/src-Bmm_wQsb.js",

  "./estimating/assets/es-B3LW2HXG.js",
  "./estimating/assets/index-v3ocWhvQ.js",
  "./estimating/assets/pdf-yVgGsv3V.js",
  "./estimating/assets/proposal-pdf-Dvus7tb8.js",
  "./estimating/assets/purchase-order-pdf-Bn4EaPuX.js",
  "./estimating/assets/quote-backup-pdf-D_chEpKy.js",
  "./estimating/assets/src-D2rBS8y7.js",
  "./estimating/assets/es-DlX-Rqis.js",
  "./estimating/assets/index-JdpzKb-f.js",
  "./estimating/assets/pdf-Chd8M1BR.js",
  "./estimating/assets/proposal-pdf-CzJcP5IY.js",
  "./estimating/assets/purchase-order-pdf-B9xLUwJZ.js",
  "./estimating/assets/quote-backup-pdf-DGnB5F1X.js",
  "./estimating/assets/src-B2zQCaX5.js",
  "./estimating/assets/es-BNV2GOIs.js",
  "./estimating/assets/index-Agmsgj0D.js",
  "./estimating/assets/job-accounting-workbook-B4yG4DBd.js",
  "./estimating/assets/pdf-F9E5gNCf.js",
  "./estimating/assets/proposal-pdf-CbsfC394.js",
  "./estimating/assets/purchase-order-pdf-ZT_jkXsN.js",
  "./estimating/assets/quote-backup-pdf-KV-Fd-v2.js",
  "./estimating/assets/src-YRWHBSp6.js",
  "./estimating/assets/es-B5IdPMRu.js",
  "./estimating/assets/index-Atl4n0bK.css",
  "./estimating/assets/index-CGvzTZTT.js",
  "./estimating/assets/pdf-C6MuuDe2.js",
  "./estimating/assets/proposal-pdf-Cq6HdsXH.js",
  "./estimating/assets/purchase-order-pdf-Df38Ny9B.js",
  "./estimating/assets/quote-backup-pdf-IyUqQzMf.js",
  "./estimating/assets/src-DrkuE13d.js",
  "./estimating/assets/es-FAYeD_Wv.js",
  "./estimating/assets/index-BI0CrpmC.css",
  "./estimating/assets/index-CXr9mQtO.js",
  "./estimating/assets/pdf-X2U8afx7.js",
  "./estimating/assets/proposal-pdf-BAYLlOFW.js",
  "./estimating/assets/purchase-order-pdf-DHjJOi4f.js",
  "./estimating/assets/quote-backup-pdf-Duc8gELa.js",
  "./estimating/assets/src-D4Cktuci.js",
  "./estimating/assets/es-CkcZpxX0.js",
  "./estimating/assets/index-T6X06mkz.js",
  "./estimating/assets/pdf-BVtTsckn.js",
  "./estimating/assets/proposal-pdf-CxAh0iqm.js",
  "./estimating/assets/purchase-order-pdf-UDh8lthS.js",
  "./estimating/assets/quote-backup-pdf-CZMcmWLw.js",
  "./estimating/assets/src-BsHlou_G.js",
  "./estimating/assets/es-BCHavly9.js",
  "./estimating/assets/index-5Oh0YN5A.js",
  "./estimating/assets/index-cBNvlTXI.css",
  "./estimating/assets/pdf-D5cXyckv.js",
  "./estimating/assets/proposal-pdf-D8HtewKY.js",
  "./estimating/assets/purchase-order-pdf-CU3WcyhO.js",
  "./estimating/assets/quote-backup-pdf-DpNHY68Z.js",
  "./estimating/assets/src-Dt5A2fOB.js",
  "./estimating/assets/index-CKrQIsO4.js",
  "./estimating/assets/es-2Tc5ZD1h.js",
  "./estimating/assets/pdf-CoAZyqFp.js",
  "./estimating/assets/src-BZgzdIZI.js",
  "./estimating/assets/proposal-pdf-CNXtrZka.js",
  "./estimating/assets/purchase-order-pdf-DbrUthT1.js",
  "./estimating/assets/quote-backup-pdf-BAC6InEz.js",
  "./estimating/assets/index-WzrgzAnd.css",
  "./estimating/assets/index-Cwt5oYWb.js",
  "./estimating/assets/es-bIE0GaoP.js",
  "./estimating/assets/pdf-ZkgU-4U8.js",
  "./estimating/assets/src-CcjV_gg0.js",
  "./estimating/assets/proposal-pdf-DH_NP5Ww.js",
  "./estimating/assets/purchase-order-pdf-DJqDjLlU.js",
  "./estimating/assets/quote-backup-pdf-D-lT0agP.js",
  "./estimating/assets/index-B-GXLhDz.css",
  "./estimating/assets/index-DEL2l2I8.js",
  "./estimating/assets/es-BhBZ6oGK.js",
  "./estimating/assets/pdf-m0HRr9M1.js",
  "./estimating/assets/src-CFRg80aN.js",
  "./estimating/assets/proposal-pdf-CoRLtavc.js",
  "./estimating/assets/purchase-order-pdf-YI-SgG06.js",
  "./estimating/assets/quote-backup-pdf-Dxm80SrD.js",
  "./accounts.html",
  "./accounts-admin.css?v=1",
  "./notification-settings.html",
  "./reset-password.html",
  "./aerial-lifts.html",
  "./forklift.html",
  "./harness.html",
  "./hot-work-permit.html",
  "./jsa.html",
  "./prepared-jsas.html",
  "./prepared-jsas.js?v=2",
  "./jsa-library-admin.html",
  "./jsa-library-admin.js?v=2",
  "./jsa-library-admin.css?v=3",
  "./employee-writeups.html",
  "./employee-writeups.js?v=2",
  "./employee-writeups-admin.html",
  "./employee-writeups-admin.js?v=2",
  "./employee-writeups-shared.js?v=2",
  "./employee-writeups.css?v=4",
  "./jsa-editor.js?v=3",
  "./jsa-presets.js?v=2",
  "./tele-handler.html",
  "./policies-admin.html",
  "./styles.css?v=3",
  "./admin.css?v=18",
  "./admin-dashboard.css?v=6",
  "./admin-dashboard.js?v=6",
  "./admin-dashboard-grid.js?v=1",
  "./admin-shell-design-system.css?v=5",
  "./inspection-history-today.css?v=2",
  "./inspection-history-previous.css?v=3",
  "./safety-records-admin.css?v=3",
  "./admin-global-search.css?v=10",
  "./accounting-admin.css?v=9",
  "./jgc-design-system.css?v=13",
  "./estimator-theme.css?v=1",
  "./certificates-admin.css?v=1",
  "./certificates-embedded.css?v=1",
  "./equipment-admin.css?v=3",
  "./employee-access-admin.css?v=3",
  "./job-lists.css?v=12",
  "./permit-design-system.css?v=2",
  "./report-design-system.css?v=2",
  "./daily-site-report.css?v=1",
  "./jsa-report.css?v=4",
  "./toolbox-talks-report.css?v=1",
  "./incident-report.css?v=1",
  "./accident-report.css?v=2",
  "./employee-injury-report.css?v=3",
  "./reports-admin.css?v=3",
  "./timesheet-design-system.css?v=7",
  "./tasks-design-system.css?v=2",
  "./directory-design-system.css?v=2",
  "./jobs-design-system.css?v=4",
  "./schedule-design-system.css?v=7",
  "./schedule-ui.js?v=1",
  "./work-orders-design-system.css?v=4",
  "./vacation-design-system.css?v=2",
  "./specialty-inspection-design-system.css?v=4",
  "./qr-inspection-design-system.css?v=2",
  "./equipment-qr-inspection.css?v=1",
  "./vehicle-qr-inspection.css?v=1",
  "./home-design-system.css?v=8",
  "./notification-settings-design-system.css?v=4",
  "./acknowledgement-design-system.css?v=3",
  "./login-design-system.css?v=11",
  "./common.js?v=74",
  "./admin-global-search.js?v=10",
  "./accounting-workbook.js?v=9",
  "./accounting-admin.js?v=14",
  "./employee-feature-access.js?v=3",
  "./employee-access-admin.js?v=4",
  "./job-lists.js?v=15",
  "./job-lists-admin.js?v=3",
  "./admin-housekeeping.js?v=1",
  "./shared-uploads.css?v=3",
  "./shared-uploads.js?v=3",
  "./offline-sync.js?v=2",
  "./admin-backups.js?v=3",
  "./admin-contacts.js?v=3",
  "./admin-vacation.js?v=4",
  "./admin-notices.js?v=4",
  "./admin-certificates.js?v=4",
  "./admin-inspections.js?v=4",
  "./admin-reports.js?v=5",
  "./admin-employee-profile.js?v=1",
  "./admin-work-orders.js?v=4",
  "./admin-equipment.js?v=2",
  "./admin-timesheets.js?v=11",
  "./admin-summary.js?v=9",
  "./admin-core.js?v=7",
  "./diagnostics-admin.css?v=2",
  "./diagnostics-admin.js?v=2",
  "./purchase-orders.css?v=23",
  "./purchase-orders-pdf.js?v=2",
  "./purchase-orders.js?v=24",
  "./purchase-orders-admin.js?v=14",
  "./work-order-digital-pos.js?v=3",
  "./safety-signature-pad.css?v=3",
  "./safety-signature-pad.js?v=3",
  "./safety-acknowledgements.js?v=8",
  "./jsa-pdf.js?v=5",
  "./field-calculator.css?v=18",
  "./calculator-engine.js?v=25",
  "./calculator-functions.js?v=28",
  "./field-calculator.js?v=31",
  "./auth.js?v=9",
  "./login-session.js?v=1",
  "./inspection-records.js?v=15",
  "./inspection-mobile.css?v=3",
  "./inspection-mobile.js?v=6",
  "./manifest.json?v=7",
  "./vendor/supabase-js.min.js?v=1",
  "./vendor/tus.min.js?v=1",
  "./vendor/exceljs.min.js?v=1",
  "./vendor/jszip.min.js?v=1",
  "./vendor/jspdf.umd.min.js?v=1",
  "./vendor/lucide.min.js",
  "./estimating/assets/index-YO7c-Iih.js",
  "./estimating/assets/index-Dt94VnXX.css",
  "./estimating/assets/es-Cu8XtmXr.js",
  "./estimating/assets/pdf-WPOJp7IN.js",
  "./estimating/assets/src-CcQg65H3.js",
  "./estimating/assets/proposal-pdf-C9SQcIGI.js",
  "./estimating/assets/purchase-order-pdf-C8-tw26M.js",
  "./estimating/assets/quote-backup-pdf-Bholqkk_.js",
  "./estimating/assets/index-B_X8E56Y.js",
  "./estimating/assets/index-7Pj3K3ku.css",
  "./estimating/assets/es-JL8ncCbV.js",
  "./estimating/assets/pdf-C19sCD5v.js",
  "./estimating/assets/src-jKtzPL7C.js",
  "./estimating/assets/proposal-pdf-T3kc2eCO.js",
  "./estimating/assets/purchase-order-pdf-Sc-MiMkk.js",
  "./estimating/assets/quote-backup-pdf-DypFCuDh.js",
  "./estimating/assets/index-DOPzMPZy.js",
  "./estimating/assets/index-B9PJcji5.css",
  "./estimating/assets/es-CjOsvvCd.js",
  "./estimating/assets/pdf-Dx9_N_GI.js",
  "./estimating/assets/src-U-R7Id6_.js",
  "./estimating/assets/proposal-pdf-n6XSpN59.js",
  "./estimating/assets/purchase-order-pdf-CUrPi3sU.js",
  "./estimating/assets/quote-backup-pdf-hyNTLTz3.js",
  "./estimating/assets/index-7v-nNOMe.js",
  "./estimating/assets/index-BerJRNfj.css",
  "./estimating/assets/es-B1QGMgbG.js",
  "./estimating/assets/pdf-sJdWmeEG.js",
  "./estimating/assets/src-DNQ0-cIQ.js",
  "./estimating/assets/proposal-pdf-BIMWJ0wy.js",
  "./estimating/assets/purchase-order-pdf-CzpJ-pK3.js",
  "./estimating/assets/quote-backup-pdf-Es2NWomN.js",
  "./estimating/assets/index-D5bg2Aoz.js",
  "./estimating/assets/index-Cq6qcbvm.css",
  "./estimating/assets/es-DfNDvGdY.js",
  "./estimating/assets/pdf-DjU5Xkxn.js",
  "./estimating/assets/src-BGIqZ8Vv.js",
  "./estimating/assets/proposal-pdf-D3KZIgFU.js",
  "./estimating/assets/purchase-order-pdf-Dg0-xmVu.js",
  "./estimating/assets/quote-backup-pdf-DOsRpBvz.js",
  "./estimating/assets/index-BXasRDaq.js",
  "./estimating/assets/es-D_CF-AMp.js",
  "./estimating/assets/pdf-tsk1kJ7a.js",
  "./estimating/assets/src-Dg0NQiH_.js",
  "./estimating/assets/proposal-pdf-D0fiUnHt.js",
  "./estimating/assets/purchase-order-pdf-BaXGk6yV.js",
  "./estimating/assets/quote-backup-pdf-DeRmxmpu.js",
  "./estimating/assets/index-x0v69QTF.js",
  "./estimating/assets/index-PvTVewfb.css",
  "./estimating/assets/es-CDS0acVr.js",
  "./estimating/assets/pdf-Cn95CSww.js",
  "./estimating/assets/src-CgmJP66g.js",
  "./estimating/assets/proposal-pdf-B0hLnAtz.js",
  "./estimating/assets/purchase-order-pdf-DhRMpQ5u.js",
  "./estimating/assets/quote-backup-pdf-Cb5ODrxr.js",
  "./estimating/assets/index-CotW7wdg.js",
  "./estimating/assets/index-CGoL2ogD.css",
  "./estimating/assets/es-B8HSbBC-.js",
  "./estimating/assets/pdf-CeSzYUcn.js",
  "./estimating/assets/src-l1rnY2I6.js",
  "./estimating/assets/proposal-pdf-gQ6yoXhu.js",
  "./estimating/assets/purchase-order-pdf-D8N0f9E_.js",
  "./estimating/assets/quote-backup-pdf-PrmwnrII.js",
  "./estimating/assets/index-CR9JU4Ju.js",
  "./estimating/assets/index-Cbqwhm-3.css",
  "./estimating/assets/es-DV_xeIBW.js",
  "./estimating/assets/pdf-DT4ISb1r.js",
  "./estimating/assets/src-DPvqSf3B.js",
  "./estimating/assets/proposal-pdf-_eEgp25r.js",
  "./estimating/assets/purchase-order-pdf-BecqiZBK.js",
  "./estimating/assets/quote-backup-pdf-CxEVPaW2.js",
  "./estimating/assets/index-DZBJjn2f.js",
  "./estimating/assets/index-CJIg6uPY.css",
  "./estimating/assets/es-BFsECWFO.js",
  "./estimating/assets/pdf-DUiL6fyP.js",
  "./estimating/assets/src-BSgnj78Y.js",
  "./estimating/assets/proposal-pdf-D4Lhs4zM.js",
  "./estimating/assets/purchase-order-pdf-CTIUi3Ap.js",
  "./estimating/assets/quote-backup-pdf-CjNxE8IP.js",
  "./estimating/assets/index-C9eAQf1L.js",
  "./estimating/assets/index-DmCdYfyW.css",
  "./estimating/assets/es-CNtsJwuB.js",
  "./estimating/assets/pdf-CVnUlr-3.js",
  "./estimating/assets/src-DxeEbAbd.js",
  "./estimating/assets/proposal-pdf-BL2Q3HMP.js",
  "./estimating/assets/purchase-order-pdf-C6LcwmDz.js",
  "./estimating/assets/quote-backup-pdf-CDeK8d4T.js",
  "./estimating/assets/index-Dc6ELC_T.js",
  "./estimating/assets/index-BMY7CJOx.css",
  "./estimating/assets/es-FnbUzRNz.js",
  "./estimating/assets/pdf-APJQDuSM.js",
  "./estimating/assets/src-Dpr7gd2i.js",
  "./estimating/assets/proposal-pdf-Be205wqG.js",
  "./estimating/assets/purchase-order-pdf-CSQ4WNXT.js",
  "./estimating/assets/quote-backup-pdf-CJwNiSjP.js",
  "./estimating/assets/index-BHiTwya3.js",
  "./estimating/assets/es-CuvPXv3i.js",
  "./estimating/assets/pdf-BbyhQQTT.js",
  "./estimating/assets/src-CrMiArvv.js",
  "./estimating/assets/proposal-pdf-DVJSVI7g.js",
  "./estimating/assets/purchase-order-pdf-BoQ_lblt.js",
  "./estimating/assets/quote-backup-pdf-BejJ3zfN.js",
  "./estimating/assets/index-CZMzh-RS.js",
  "./estimating/assets/es-DBOqyaEY.js",
  "./estimating/assets/pdf-CLW7yuKz.js",
  "./estimating/assets/src-DOqikQaL.js",
  "./estimating/assets/proposal-pdf-Ci9JMI7X.js",
  "./estimating/assets/purchase-order-pdf-T-Cp1xxu.js",
  "./estimating/assets/quote-backup-pdf-CYYZ8yDL.js",
  "./estimating/assets/index-XlymjuG1.js",
  "./estimating/assets/index-VacREjai.css",
  "./estimating/assets/es-DgZ5dOX_.js",
  "./estimating/assets/pdf-Dc9NUOd9.js",
  "./estimating/assets/src-BlGJcNfj.js",
  "./estimating/assets/proposal-pdf-CaTreAzG.js",
  "./estimating/assets/purchase-order-pdf-Cg1k7mJC.js",
  "./estimating/assets/quote-backup-pdf-ZcpAm7Ll.js",
  "./estimating/jgc-letterhead-logo.jpg",
  "./estimating/jgc-logo-transparent.png",
  "./logo.webp",
  "./login-background.webp",
  "./jgc-login-qr.png",
  "./jgc-login-qr-print.png",
  "./icon-180.png?v=4",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4"
];

function isJgcCacheableResponse(response) {
  return Boolean(response && (response.ok || response.type === "opaque"));
}

function storeJgcResponse(request, response) {
  if (!isJgcCacheableResponse(response)) {
    return Promise.resolve();
  }

  const copy = response.clone();
  return caches
    .open(JGC_CACHE_NAME)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

async function cacheJgcAppShellAsset(cache, url) {
  const request = new Request(url, { cache: "reload" });
  // Content-hashed build files are immutable. Copy them across release caches
  // instead of downloading the same large historical bundles on every update.
  if (/\/estimating\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(new URL(url, self.location.href).pathname)) {
    const existing = await caches.match(request);
    if (existing && existing.ok) return cache.put(url, existing);
  }

  return fetch(request).then((response) => {
    if (!response || !response.ok) {
      const status = response ? response.status : "no response";
      throw new Error(`JGC app shell could not cache ${url} (${status}).`);
    }

    return cache.put(url, response);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(JGC_CACHE_NAME)
      .then((cache) => Promise.all(JGC_APP_SHELL.map((url) => cacheJgcAppShellAsset(cache, url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(JGC_CACHE_PREFIX) && key !== JGC_CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

const JGC_NAVIGATION_WAIT_MS = 3000;

function getJgcNavigationResponse(event) {
  const request = event.request;
  const network = fetch(request).then(async (response) => {
    if (!response.ok) throw new Error("Page request failed");
    const pageUrl = new URL(request.url); pageUrl.search = ""; pageUrl.hash = "";
    await storeJgcResponse(pageUrl.href, response);
    return response;
  });
  // Keep the refresh alive after returning a saved screen; no API responses are cached.
  event.waitUntil(network.then(() => {}, () => {}));
  return caches.open(JGC_CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (!cached) {
      return network.catch(async () => (await cache.match("./index.html")) || Response.error());
    }
    let timer;
    try {
      return await Promise.race([
        network.catch(() => cached),
        new Promise((resolve) => { timer = setTimeout(() => resolve(cached), JGC_NAVIGATION_WAIT_MS); })
      ]);
    } finally { clearTimeout(timer); }
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.hostname.includes("supabase.co") || url.hostname.includes("script.google.com")) {
    return;
  }

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(getJgcNavigationResponse(event));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request, { cache: "reload" }).then((response) => {
            storeJgcResponse(request, response);
          }).catch(() => {});
          return cached;
        }

        return fetch(request, { cache: "reload" }).then((response) => {
          storeJgcResponse(request, response);
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      storeJgcResponse(request, response);
      return response;
    }))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      title: "JGC Portal",
      body: event.data ? event.data.text() : "New portal notification"
    };
  }

  const title = payload.title || "JGC Portal";
  const options = {
    body: payload.body || payload.message || "New portal notification",
    icon: payload.icon || "./icon-192.png?v=4",
    badge: payload.badge || "./icon-180.png?v=4",
    tag: payload.tag || payload.notification_id || "jgc-portal-notification",
    data: {
      url: payload.url || payload.link_url || "./home.html",
      notification_id: payload.notification_id || ""
    },
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data && event.notification.data.url || "./home.html", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client && client.url === targetUrl) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    })
  );
});
